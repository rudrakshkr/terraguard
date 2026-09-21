/**
 * HillSense AI service worker — offline-first app shell.
 *
 * Strategy per request type:
 *  - App shell / static assets: stale-while-revalidate. The app always opens
 *    instantly, even offline.
 *  - GET /api/incidents… and /api/incidents/<id>: network-first with cache
 *    fallback. Online you always get live data; offline the last-seen data is
 *    served from Cache Storage and flagged as cached by the app.
 *  - Safety guidance (kb-guidance cache + /api/safety-guidance): cache-first —
 *    this content is static and must survive full loss of connectivity.
 *  - Everything else (auth, writes, geocoding): network only. Writes made
 *    offline are queued by the app's outbox (IndexedDB) and replayed later —
 *    the worker never fakes a successful write.
 *
 * The worker NEVER invents responses: a page asked for data we do not have
 * cached gets a real error, and the UI says the data is unavailable offline.
 */

const VERSION = "hs-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const GUIDANCE_CACHE = `${VERSION}-guidance`;

const SHELL_ASSETS = ["/", "/ask", "/report", "/profile", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // Best-effort pre-cache; individual failures must not break install.
      await Promise.allSettled(SHELL_ASSETS.map((a) => shell.add(new Request(a, { cache: "reload" }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Stale-while-revalidate for the app shell and static assets. */
async function shellStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        // Best-effort revalidation write — must never break the response.
        try {
          cache.put(request.mode === "navigate" ? new Request(new URL(request.url).pathname) : request, res.clone());
        } catch { /* storage full / private mode */ }
      }
      return res;
    })
    .catch(() => null);
  if (cached) {
    void network;
    return cached;
  }
  const fresh = await network;
  if (fresh) return fresh;
  // Navigation requests get the cached app shell (Next.js client router).
  if (request.mode === "navigate") {
    const fallback = await cache.match(new Request(new URL("/", self.location).href));
    if (fallback) return fallback;
    const anyShell = await cache.match("/ask") || await cache.match("/report");
    if (anyShell) return anyShell;
  }
  return new Response(JSON.stringify({ error: "offline-unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

/** Network-first for live data APIs; fall back to the last successful copy. */
async function dataStrategy(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      // Key by pathname (drop auth headers' variance) so offline reads work
      // regardless of whether the original request was authenticated. The
      // put is best-effort: a storage failure must never fail the request.
      try {
        const key = new Request(new URL(request.url).pathname, { method: "GET" });
        await cache.put(key, res.clone());
      } catch (putErr) {
        console.warn("[sw] cache.put failed (continuing)", putErr);
      }
    }
    return res;
  } catch {
    const key = new Request(new URL(request.url).pathname, { method: "GET" });
    const cached = await cache.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-HillSense-Cached", "1");
      return new Response(await cached.clone().arrayBuffer(), {
        status: cached.status,
        statusText: "cached",
        headers,
      });
    }
    return new Response(JSON.stringify({ error: "offline-unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Cache-first for safety guidance content. */
async function guidanceStrategy(request) {
  const cache = await caches.open(GUIDANCE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      try { await cache.put(request, res.clone()); } catch { /* best-effort */ }
    }
    return res;
  } catch {
    return new Response(JSON.stringify({ error: "offline-unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Requests from the app's own fetch client (authFetch) may carry an
  // Authorization header; Cache Storage refuses to store such requests.
  // dataStrategy keys by bare pathname, so this is safe — but we must not
  // abort the whole fetch when the PUT fails.
  if (req.method !== "GET") return; // writes go through the app's outbox

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles, fonts, CDN

  if (url.pathname.startsWith("/api/safety-guidance") || url.pathname.startsWith("/knowledge-base/")) {
    event.respondWith(guidanceStrategy(req));
    return;
  }
  if (
    url.pathname === "/api/incidents" ||
    /^\/api\/incidents\/[^/]+$/.test(url.pathname) ||
    url.pathname === "/api/clusters" ||
    url.pathname === "/api/rag-status"
  ) {
    event.respondWith(dataStrategy(req));
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // auth, analyze, ask, geo — live only
  event.respondWith(shellStrategy(req));
});
