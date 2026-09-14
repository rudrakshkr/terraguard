/**
 * Storage adapter for HillSense's JSON stores.
 *
 * Two modes, chosen by environment (no code changes needed between them):
 *
 *  - REDIS mode (serverless deploys, e.g. Vercel):
 *      Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 *      Every store lives under a single namespaced key as one JSON document.
 *      Writes use an optimistic compare-and-set (Lua EVAL) retry loop so two
 *      serverless instances can never clobber each other — this is what keeps
 *      "one confirmation per user" correct across concurrent requests from
 *      different phones.
 *
 *  - FILE mode (default, local dev / single server):
 *      Plain JSON files in the project root, exactly as before. Single-process
 *      access makes read-modify-write safe without CAS.
 *
 * Documents are tiny (reports/auth metadata contain no images), well within
 * Upstash's limits.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** True when a Redis-compatible REST backend is configured. */
export const kvEnabled = Boolean(REST_URL && REST_TOKEN);

/** Writable directory for file-mode data (serverless fallbacks use /tmp). */
export const dataDir = process.env.HS_DATA_DIR || process.cwd();

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

/** Read a JSON document; null when the key does not exist. */
export async function kvGetJson<T>(key: string): Promise<T | null> {
  const { result } = await rest(["GET", key]);
  if (result == null) return null;
  const raw = typeof result === "string" ? result : JSON.stringify(result);
  return JSON.parse(raw) as T;
}

/** Write a JSON document (no concurrency guard — prefer kvMutate). */
export async function kvSetJson(key: string, value: unknown): Promise<void> {
  await rest(["SET", key, JSON.stringify(value)]);
}

/** Set only when the key does not exist yet (first-boot seeding). */
export async function kvSetIfMissing(key: string, value: unknown): Promise<boolean> {
  const { result } = await rest(["SET", key, JSON.stringify(value), "NX"]);
  return result === "OK";
}

/**
 * Compare-and-set script: writes `next` only when the stored value is still
 * `prev`. A missing stored value only matches the `missing` sentinel.
 */
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

/**
 * Atomic read-modify-write for Redis mode.
 *
 * `fallback` produces the initial document when the key is empty (first boot).
 * `fn` receives the current document and returns the next one plus a result
 * value; it may run more than once under contention, so it must be pure with
 * respect to external state.
 */
export async function kvMutate<T, R>(
  key: string,
  fallback: () => T | Promise<T>,
  fn: (doc: T) => { doc: T; result: R } | Promise<{ doc: T; result: R }>,
): Promise<R> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    try {
      const current = await kvGetJson<T>(key);
      const missing = current === null;
      const base = missing ? await fallback() : current!;
      const { doc, result } = await fn(base);
      const { result: cas } = await rest([
        "EVAL",
        CAS_LUA,
        "1",
        key,
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
