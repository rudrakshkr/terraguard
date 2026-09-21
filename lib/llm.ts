/**
 * Thin OpenAI-compatible client (fetch, no SDK).
 *
 * Default provider: Google Gemini (free tier) via its OpenAI-compatibility
 * layer — https://ai.google.dev/gemini-api/docs/openai. Any other
 * OpenAI-compatible endpoint (OpenAI, OpenRouter, Groq, Ollama) works by
 * overriding the env vars below.
 *
 * Every call fails soft: on any error the caller receives `null` and the
 * app falls back to its deterministic heuristic engine.
 */

const BASE_URL = (
  process.env.LLM_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai"
).replace(/\/+$/, "");
const API_KEY =
  process.env.LLM_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "";
// Default chat model. gemini-3.8-flash (the previous default) chronically answers
// 503 "high demand" on the free tier; the 3.5 Flash-Lite tier stays reliably
// available, supports vision and JSON mode, and is cheaper. Override with
// LLM_MODEL for other providers (OpenAI, OpenRouter, Groq, Ollama…).
const CHAT_MODEL = process.env.LLM_MODEL || "gemini-3.5-flash-lite";
const EMBED_MODEL = process.env.LLM_EMBED_MODEL || "gemini-embedding-001";

export const aiAvailable = () => API_KEY.length > 0;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

/**
 * Retry transient provider failures (429 rate limit, 5xx capacity, network).
 * The free-tier endpoint regularly answers 503 "high demand"; a single attempt
 * made the whole app silently degrade to heuristic mode for minutes at a time.
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Honor Retry-After when the provider sends one, else jittered exponential backoff. */
async function retryDelay(attempt: number, retryAfterHeader: string | null): Promise<void> {
  const parsed = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN;
  const base = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed * 1000, 8000) : RETRY_BASE_MS * 2 ** attempt;
  await sleep(Math.floor(base * (0.5 + Math.random() * 0.5)));
}

function extractJson(raw: string): unknown | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Plain-text chat completion. Returns null on any failure. */
export async function chatText(
  messages: LlmMessage[],
  timeoutMs = 45_000,
): Promise<string | null> {
  if (!API_KEY) return null;

  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ model: CHAT_MODEL, messages, temperature: 0.3 }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error(`[llm] HTTP ${res.status}:`, (await res.text()).slice(0, 300));
        if (RETRYABLE_STATUS.has(res.status) && attempt < RETRY_ATTEMPTS - 1) {
          await retryDelay(attempt, res.headers.get("retry-after"));
          continue;
        }
        return null;
      }
      const data = await res.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      return typeof content === "string" && content.trim() ? content.trim() : null;
    } catch (err) {
      console.error("[llm] request failed:", err);
      // Network/abort errors on the first attempts are worth one retry too.
      if (attempt < RETRY_ATTEMPTS - 1) {
        await retryDelay(attempt, null);
        continue;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Chat completion expected to return JSON. Returns null on any failure. */
export async function chatJSON<T>(
  messages: LlmMessage[],
  timeoutMs = 45_000,
): Promise<T | null> {
  if (!API_KEY) return null;

  const call = async (useJsonMode: boolean): Promise<{ ok: boolean; content?: string; status: number; retryAfter: string | null }> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages,
          temperature: 0.2,
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        console.error(`[llm] HTTP ${res.status}:`, (await res.text()).slice(0, 300));
        return { ok: false, status: res.status, retryAfter: res.headers.get("retry-after") };
      }
      const data = await res.json();
      const content: string | undefined = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") return { ok: false, status: 500, retryAfter: null };
      return { ok: true, content, status: 200, retryAfter: null };
    } catch (err) {
      console.error("[llm] request failed:", err);
      return { ok: false, status: 0, retryAfter: null };
    } finally {
      clearTimeout(timer);
    }
  };

  // Prefer JSON mode; retry transient provider failures (429/5xx) with backoff,
  // then one automatic retry without the flag for providers that reject it.
  let jsonModeRejected = false;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    const first = await call(true);
    if (first.ok) return extractJson(first.content!) as T | null;
    if (first.status === 400) {
      // Provider likely rejects response_format — fall through to plain mode below.
      jsonModeRejected = true;
      break;
    }
    if (RETRYABLE_STATUS.has(first.status) && attempt < RETRY_ATTEMPTS - 1) {
      await retryDelay(attempt, first.retryAfter);
      continue;
    }
    return null; // non-retryable (401/403/etc.) or retries exhausted
  }
  if (jsonModeRejected) {
    const second = await call(false);
    if (second.ok) return extractJson(second.content!) as T | null;
  }
  return null;
}

/** Embed a batch of texts; auto-chunks large batches to stay inside provider limits. */
export async function embedAPI(texts: string[], timeoutMs = 20_000): Promise<number[][] | null> {
  if (!API_KEY || texts.length === 0) return null;
  const BATCH = 64; // Gemini accepts up to 100 embedding inputs per request
  if (texts.length <= BATCH) return embedAPIBatch(texts, timeoutMs);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const part = await embedAPIBatch(texts.slice(i, i + BATCH), timeoutMs);
    if (!part) return null;
    out.push(...part);
  }
  return out;
}

/** Single embeddings request. Returns null on any failure so RAG can fall back to local vectors. */
async function embedAPIBatch(texts: string[], timeoutMs: number): Promise<number[][] | null> {
  if (!API_KEY) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.error(`[llm] embeddings HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const vectors = data?.data?.map((d: { embedding?: number[] }) => d.embedding);
    if (!Array.isArray(vectors) || vectors.length !== texts.length) return null;
    return vectors as number[][];
  } catch (err) {
    console.error("[llm] embeddings failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
