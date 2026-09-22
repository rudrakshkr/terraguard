/**
 * HillSense AI service worker — offline-first app shell.
 *
 * Strategy per request type:
 *  - Page navigations: network-first, with the cached shell as the offline
 *    fallback. Online users always get the CURRENT build (a stale shell would
 *    run an old client bundle against new APIs); offline the cached shell
 *    opens instantly.
 *  - Static assets: stale-while-revalidate (they are content-hashed, so a
 *    cached copy is always the right copy for the shell that asked for it).
 *  - Public GET /api/incidents?public=1 and GET /api/clusters: network-first
 *    with cache fallback. These responses contain public data only.
 *  - Incident detail is NOT cached by the worker because authenticated detail
 *    responses contain the caller's private `my_confirmation` state. The app
 *    stores detail copies in user-scoped IndexedDB instead.
 *  - Safety guidance (kb-guidance cache + /api/safety-guidance): cache-first —
 *    this content is static and must survive full loss of connectivity.
 *  - Everything else (auth, writes, geocoding): network only. Writes made
 *    offline are queued by the app's outbox (IndexedDB) and replayed later —
 *    the worker never fakes a successful write.
 *
 * The worker NEVER invents responses: a page asked for data we do not have
 * cached gets a real error, and the UI says the data is unavailable offline.
 */

const VERSION = "hs-v4";
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const GUIDANCE_CACHE = `${VERSION}-guidance`;

const SHELL_ASSETS = ["/", "/ask", "/report", "/profile", "/login", "/onboarding", "/home", "/dashboard", "/manifest.webmanifest"];

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

/** Stale-while-revalidate for static assets; network-first for navigations. */
async function shellStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);

  // Page navigations must reflect the deployed build so an updated client is
  // never paired with an older/newer API. The cache is the offline fallback.
  if (request.mode === "navigate") {
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        try {
          await cache.put(new Request(new URL(request.url).pathname), res.clone());
        } catch { /* storage full / private mode */ }
      }
      return res;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const root = await cache.match(new Request(new URL("/", self.location).href));
      if (root) return root;
      const anyShell = (await cache.match("/ask")) || (await cache.match("/report"));
      if (anyShell) return anyShell;
      return new Response(JSON.stringify({ error: "offline-unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        // Best-effort revalidation write — must never break the response.
        try {
          cache.put(request, res.clone());
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
      try {
        // Cache by the full URL, including query parameters. Never cache a
        // personalized response that carries Authorization.
        await cache.put(new Request(request.url, { method: "GET" }), res.clone());
      } catch (putErr) {
        console.warn("[sw] cache.put failed (continuing)", putErr);
      }
    }
    return res;
  } catch {
    const key = new Request(request.url, { method: "GET" });
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
  // Only explicitly public, non-authenticated API reads are cacheable.
  // Personalized or write-like endpoints stay network-only.
  if (req.method !== "GET") return; // writes go through the app's outbox

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // tiles, fonts, CDN

  if (url.pathname.startsWith("/api/safety-guidance") || url.pathname.startsWith("/knowledge-base/")) {
    event.respondWith(guidanceStrategy(req));
    return;
  }
  if (url.pathname === "/api/incidents" || url.pathname === "/api/clusters") {
    const hasAuth = req.headers.has("authorization");
    const isPublicIncidents = url.pathname === "/api/incidents" && url.searchParams.get("public") === "1";
    if (!hasAuth && (url.pathname === "/api/clusters" || isPublicIncidents)) {
      event.respondWith(dataStrategy(req));
      return;
    }
    // Authenticated/private responses remain network-only. Incident detail is
    // deliberately excluded from SW caching because it contains the caller's
    // private `my_confirmation` state; the app's IndexedDB detail cache is
    // user-scoped instead.
  }
  if (url.pathname.startsWith("/api/")) return; // auth, analyze, ask, geo — live only
  event.respondWith(shellStrategy(req));
});