/**
 * Storage adapter for HillSense's JSON stores.
 *
 * Three modes, chosen automatically (no code changes between them):
 *
 *  1. UPSTASH mode  — UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set.
 *     Writes use a Lua compare-and-set retry loop.
 *
 *  2. BLOB mode — BLOB_READ_WRITE_TOKEN present (Vercel Blob, incl. the free
 *     hobby tier). Serverless has no shared disk, so this is the default on
 *     Vercel deployments. Correctness comes from a short-term LEASE file that
 *     is created with allowOverwrite:false — exactly one writer holds it, so
 *     read-modify-write mutations are serialized per key and concurrent
 *     requests (e.g. two phones confirming at once) can never clobber each
 *     other or double-submit. Expired leases are reclaimed automatically.
 *
 *  3. FILE mode (default, local dev) — plain JSON files in the project root,
 *     exactly as before. Single-process access makes read-modify-write safe.
 *
 * Documents are tiny (no images are stored), well within all limits.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
/** Vercel OIDC style: store id + a runtime OIDC token (no static credentials). */
const BLOB_OIDC = Boolean(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN);
/** Escape hatch: set HS_STORE=file to force local files even with a blob token. */
const FORCE_FILE = process.env.HS_STORE === "file";

export type KvMode = "upstash" | "blob" | "file";

export const kvMode: KvMode = FORCE_FILE
  ? "file"
  : REST_URL && REST_TOKEN
    ? "upstash"
    : BLOB_TOKEN || BLOB_OIDC
      ? "blob"
      : "file";

/** True in either remote (shared) mode. */
export const kvEnabled = kvMode !== "file";

/** Writable directory for file-mode data (serverless fallbacks use /tmp). */
export const dataDir = process.env.HS_DATA_DIR || process.cwd();

/* ------------------------------- upstash rest ------------------------------ */

async function rest(cmd: unknown[]): Promise<{ result: unknown; error?: string }> {
  const res = await fetch(REST_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv: REST ${res.status}`);
  return (await res.json()) as { result: unknown; error?: string };
}

async function upstashGetJson<T>(key: string): Promise<T | null> {
  const { result } = await rest(["GET", key]);
  if (result == null) return null;
  const raw = typeof result === "string" ? result : JSON.stringify(result);
  return JSON.parse(raw) as T;
}

async function upstashSetJson(key: string, value: unknown): Promise<void> {
  await rest(["SET", key, JSON.stringify(value)]);
}

/** Compare-and-set script: writes `next` only when the stored value is still `prev`. */
const CAS_LUA = `
local v = redis.call("GET", KEYS[1])
if (not v) then
  if ARGV[1] == "__missing__" then redis.call("SET", KEYS[1], ARGV[2]); return 1 end
  return 0
end
if v == ARGV[1] then redis.call("SET", KEYS[1], ARGV[2]); return 1 end
return 0
`;

const CAS_RETRIES = 20;
const CAS_MAX_BACKOFF_MS = 400;

async function upstashMutate<T, R>(
  key: string,
  fallback: () => T | Promise<T>,
  fn: (doc: T) => { doc: T; result: R } | Promise<{ doc: T; result: R }>,
): Promise<R> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    try {
      const current = await upstashGetJson<T>(key);
      const missing = current === null;
      const base = missing ? await fallback() : current!;
      const { doc, result } = await fn(base);
      const { result: cas } = await rest([
        "EVAL", CAS_LUA, "1", key,
        missing ? "__missing__" : JSON.stringify(base),
        JSON.stringify(doc),
      ]);
      if (cas === 1) return result;
      // Lost the race — re-read and try again with fresh data.
    } catch (err) {
      lastErr = err;
    }
    // Jittered exponential backoff: without the random component, every loser
    // retries in lockstep and keeps colliding (thundering herd).
    const cap = Math.min(CAS_MAX_BACKOFF_MS, 25 * 2 ** attempt);
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * cap)));
  }
  throw new Error(`kv: could not update "${key}" after ${CAS_RETRIES} attempts${lastErr ? `: ${String(lastErr)}` : ""}`);
}

/* ------------------------------- blob backend ------------------------------ */

/**
 * The Blob operations kv.ts needs. Production wires this to @vercel/blob;
 * tests inject an in-memory adapter. Kept minimal and injectable so the
 * locking logic is testable without network access.
 */
export interface BlobLike {
  /** Read a document; null when it does not exist. */
  get(path: string): Promise<string | null>;
  /** Create a document — must fail when the path already exists. */
  putNew(path: string, body: string): Promise<void>;
  /** Create or overwrite. */
  put(path: string, body: string): Promise<void>;
  del(path: string): Promise<void>;
}

let blobAdapter: BlobLike | null = null;

/** Test hook: replace the production blob adapter (e.g. with an in-memory one). */
export function __setBlobAdapterForTests(a: BlobLike | null): void {
  blobAdapter = a;
}

async function realBlob(): Promise<BlobLike> {
  const mod = await import("@vercel/blob");
  return {
    async get(path) {
      // useCache:false reads origin storage — never a stale CDN copy.
      const res = await mod.get(path, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200 || !res.stream) return null;
      // Buffer the SDK's stream via Response (ReadableStream has no .text()).
      return await new Response(res.stream).text();
    },
    async putNew(path, body) {
      // Throws when the path exists — the create-only primitive for leases.
      await mod.put(path, body, { access: "private", addRandomSuffix: false, allowOverwrite: false });
    },
    async put(path, body) {
      await mod.put(path, body, { access: "private", addRandomSuffix: false, allowOverwrite: true });
    },
    async del(path) {
      await mod.del(path);
    },
  };
}

async function blob(): Promise<BlobLike> {
  if (!blobAdapter) blobAdapter = await realBlob();
  return blobAdapter;
}

const LEASE_MS = 15_000; // lease lifetime — mutations finish in well under this
const LOCK_ATTEMPTS = 40;
const LOCK_MAX_BACKOFF_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serialized mutation for Blob mode: acquire a lease file (create-only), run
 * the mutation, release. Expired leases from crashed writers are reclaimed.
 */
async function withLease<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const b = await blob();
  const lockPath = `hillsense/locks/${key}.json`;
  const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      await b.putNew(lockPath, JSON.stringify({ owner, exp: Date.now() + LEASE_MS }));
      // We hold the lease.
      try {
        return await fn();
      } finally {
        // Release only if we still own it (guards against steal-after-expiry).
        try {
          const cur = await b.get(lockPath);
          if (cur && (JSON.parse(cur) as { owner?: string }).owner === owner) {
            await b.del(lockPath);
          }
        } catch {
          /* release is best-effort — the lease expires on its own */
        }
      }
    } catch {
      // Put failed — path exists or transient error. Steal expired leases.
      try {
        const cur = await b.get(lockPath);
        if (cur === null) continue; // vanished between put and get — retry at once
        if ((JSON.parse(cur) as { exp?: number }).exp !== undefined &&
            (JSON.parse(cur) as { exp: number }).exp < Date.now()) {
          await b.del(lockPath);
          continue;
        }
      } catch {
        /* fall through to backoff */
      }
      const cap = Math.min(LOCK_MAX_BACKOFF_MS, 15 * 2 ** attempt);
      await sleep(Math.floor(Math.random() * cap) + 5);
    }
  }
  throw new Error(`kv: could not acquire lease for "${key}" after ${LOCK_ATTEMPTS} attempts`);
}

/* ------------------------------ unified API -------------------------------- */

function blobPath(key: string): string {
  return `hillsense/data/${key}.json`;
}

/** Read a document in any mode; `fallback()` fills first boot (may persist it). */
export async function kvLoadDoc<T>(key: string, fallback: () => T | Promise<T>): Promise<T> {
  if (kvMode === "upstash") {
    const doc = await upstashGetJson<T>(key);
    if (doc !== null) return doc;
    const seed = await fallback();
    await upstashSetJson(key, seed);
    return seed;
  }
  if (kvMode === "blob") {
    const raw = await (await blob()).get(blobPath(key));
    if (raw !== null) return JSON.parse(raw) as T;
    return fallback(); // first mutation persists it
  }
  throw new Error("kvLoadDoc is not for file mode");
}

/**
 * Atomic read-modify-write in either remote mode.
 *
 * `fallback` produces the initial document when the key is empty (first boot).
 * `fn` receives the current document and returns the next one plus a result
 * value; it may run more than once, so it must be pure with respect to
 * external state.
 */
export async function kvMutate<T, R>(
  key: string,
  fallback: () => T | Promise<T>,
  fn: (doc: T) => { doc: T; result: R } | Promise<{ doc: T; result: R }>,
): Promise<R> {
  if (kvMode === "upstash") return upstashMutate(key, fallback, fn);
  if (kvMode === "blob") {
    return withLease(key, async () => {
      const b = await blob();
      const raw = await b.get(blobPath(key));
      const base = raw !== null ? (JSON.parse(raw) as T) : await fallback();
      const { doc, result } = await fn(base);
      await b.put(blobPath(key), JSON.stringify(doc));
      return result;
    });
  }
  throw new Error("kvMutate is not for file mode");
}

/* --------------------------- upstash legacy helper -------------------------- */

/** Set only when the key does not exist yet (Upstash first-boot seeding). */
export async function kvSetIfMissing(key: string, value: unknown): Promise<boolean> {
  if (kvMode !== "upstash") return false;
  const { result } = await rest(["SET", key, JSON.stringify(value), "NX"]);
  return result === "OK";
}

/* ------------------------------ simple getters ----------------------------- */

/** Read a JSON document (Upstash mode). Null when the key does not exist. */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  if (kvMode !== "upstash") throw new Error("kvGetJson is Upstash-only");
  return upstashGetJson<T>(key);
}

/** Write a document in either remote mode (no concurrency guard — prefer kvMutate). */
export async function kvSaveDoc(key: string, value: unknown): Promise<void> {
  if (kvMode === "upstash") return upstashSetJson(key, value);
  if (kvMode === "blob") return (await blob()).put(blobPath(key), JSON.stringify(value));
  throw new Error("kvSaveDoc is not for file mode");
}
