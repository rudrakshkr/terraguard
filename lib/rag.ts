/**
 * Minimal but real RAG pipeline, 100% JS.
 *
 * 1. Load + chunk the markdown knowledge base (deterministic).
 * 2. Index time: embed chunks via the OpenAI-compatible API. If no key /
 *    no network, a deterministic local hash embedder is used instead so
 *    retrieval ALWAYS works offline.
 * 3. Query time: embed the query (API first, local fallback) and return the
 *    top-k chunks by cosine similarity.
 *
 * The store is persisted to `.hillsense-store.json` on first use.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./kv";
import { embedAPI, aiAvailable } from "./llm";

export interface Chunk {
  id: string;
  doc: string;
  title: string;
  heading: string;
  text: string;
  embedding?: number[] | null;
  organization?: string;
  material?: string;
}

/**
 * Minimal front-matter: a leading `---` block of `key: value` lines.
 * Lets future OFFICIAL documents carry organization/verified metadata that
 * flows through to the UI without any RAG-engine changes.
 */
function parseFrontMatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(end + 4) };
}

const KB_DIR = path.join(process.cwd(), "knowledge-base");
const STORE_PATH = path.join(dataDir, ".hillsense-store.json");

let storePromise: Promise<{ chunks: Chunk[]; embedder: "api" | "local" }> | null = null;

/** Split markdown into heading-scoped chunks sized for retrieval. */
function chunkMarkdown(doc: string, title: string, raw: string): Omit<Chunk, "embedding">[] {
  const lines = raw.split("\n");
  const chunks: Omit<Chunk, "embedding">[] = [];
  let heading = title;
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 40) {
      chunks.push({ id: `${doc}-${chunks.length}`, doc, title, heading, text });
    }
    buf = [];
    size = 0;
  };

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) {
      flush();
      heading = line.replace(/^#{1,3}\s/, "").trim();
      continue;
    }
    if (/^>\s/.test(line)) continue; // skip the "sample material" banner line
    const clean = line.replace(/^[*-]\s+/, "").trim();
    if (!clean) continue;
    buf.push(clean);
    size += clean.length;
    if (size > 700) flush();
  }
  flush();
  return chunks;
}

/** Deterministic bag-of-words hash embedder — offline fallback for retrieval. */
function localEmbed(text: string, dims = 384): number[] {
  const v = new Array(dims).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[h % dims] += 1;
    // Optional second probe for a slightly denser vector.
    v[(h >>> 8) % dims] += 0.5;
  }
  return v;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "you", "your", "what", "should", "does", "how",
  "can", "with", "that", "this", "when", "while", "from", "not", "during", "near",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function termFreq(words: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
  return tf;
}

/**
 * BM25 lexical scoring over all chunks, normalized to 0..1 by the top score.
 * Gives much better ranking than raw cosine on bag-of-words vectors,
 * especially for short questions against long passages.
 */
function bm25Scores(query: string, chunks: Chunk[]): Map<string, number> {
  const k1 = 1.4;
  const b = 0.75;
  const docs = chunks.map((c) => {
    const words = tokens(`${c.title} ${c.heading} ${c.text}`);
    return { id: c.id, tf: termFreq(words), len: words.length };
  });
  const N = docs.length || 1;
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / N;
  const df = new Map<string, number>();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);

  const qTerms = [...new Set(tokens(query))];
  const scores = new Map<string, number>();
  let max = 0;
  for (const d of docs) {
    let s = 0;
    for (const w of qTerms) {
      const f = d.tf.get(w) ?? 0;
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + b * (d.len / avgLen)));
    }
    scores.set(d.id, s);
    max = Math.max(max, s);
  }
  if (max > 0) for (const [id, s] of scores) scores.set(id, s / max);
  return scores;
}

async function loadStore() {
  if (!storePromise) {
    storePromise = buildStore().catch((err) => {
      // Allow a retry on the next request instead of caching a rejected promise.
      storePromise = null;
      throw err;
    });
  }
  return storePromise;
}

async function buildStore() {
  const files = (await fs.readdir(KB_DIR)).filter((f) => f.endsWith(".md")).sort();
  const chunks: Chunk[] = [];
  for (const f of files) {
    const doc = f.replace(/\.md$/, "");
    const raw = await fs.readFile(path.join(KB_DIR, f), "utf8");
    const { meta, body } = parseFrontMatter(raw);
    for (const c of chunkMarkdown(doc, titleFrom(doc, body), body)) {
      chunks.push({
        ...c,
        organization: meta.organization,
        material: meta.material,
      });
    }
  }

  // Try to reuse a persisted store (avoids re-embedding on cold start).
  try {
    const saved = JSON.parse(await fs.readFile(STORE_PATH, "utf8")) as {
      embedder: string;
      chunks: Chunk[];
    };
    if (
      saved.embedder === "api" &&
      saved.chunks.length === chunks.length &&
      saved.chunks.every((c, i) => c.id === chunks[i].id)
    )
      return { chunks: saved.chunks, embedder: "api" as const };
  } catch {
    /* no persisted store — build one */
  }

  // Build: embed via API; on any failure persist the local embedder store.
  const api = await embedAPI(chunks.map((c) => `${c.title} — ${c.heading} — ${c.text}`));
  if (api) {
    chunks.forEach((c, i) => (c.embedding = api[i]));
    try {
      await fs.writeFile(STORE_PATH, JSON.stringify({ embedder: "api", chunks }));
    } catch {
      /* persistence is best-effort (read-only FS: rebuilt per cold start) */
    }
    return { chunks, embedder: "api" as const };
  }
  return { chunks, embedder: "local" as const };
}

function titleFrom(doc: string, raw: string): string {
  const m = raw.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? doc).replace(/\s*[—-]\s*Sample Reference Document$/i, "").trim() || doc;
}

export interface RagHit {
  id: string;
  title: string;
  doc: string;
  excerpt: string;
  score: number;
  organization?: string;
  material?: string;
}

/** Retrieve the top-k knowledge chunks for a query. Never throws. */
export async function retrieve(
  query: string,
  k = 4,
): Promise<{ hits: RagHit[]; embedder: "api" | "local" }> {
  try {
    const { chunks, embedder } = await loadStore();
    const apiResult = embedder === "api" ? await embedAPI([query]) : null;
    const apiQuery = apiResult && apiResult.length === 1 ? apiResult[0] : null;
    const qIsLocal = apiQuery === null;
    const qVec = apiQuery ?? localEmbed(query, 384);
    const bm25 = bm25Scores(query, chunks);

    const scored = chunks
      .map((c) => {
        // With real embeddings on both sides: blend semantic + lexical.
        // Otherwise: pure BM25, which stays meaningful across embedders.
        const semantic = !qIsLocal && c.embedding ? cosine(qVec, c.embedding) : 0;
        const score =
          !qIsLocal && c.embedding
            ? 0.7 * semantic + 0.3 * (bm25.get(c.id) ?? 0)
            : (bm25.get(c.id) ?? 0);
        return { chunk: c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return {
      embedder,
      hits: scored.map(({ chunk, score }) => ({
        id: chunk.id,
        title: chunk.title,
        doc: chunk.doc,
        excerpt: chunk.text.slice(0, 400),
        score: Number(score.toFixed(3)),
        organization: chunk.organization,
        material: chunk.material,
      })),
    };
  } catch (err) {
    console.error("[rag] retrieval failed:", err);
    return { embedder: "local", hits: [] };
  }
}

/** Pipeline health info for the RAG status panel. Never throws. */
export async function storeInfo(): Promise<{
  docs: number;
  chunks: number;
  embedder: "api" | "local";
  aiAvailable: boolean;
}> {
  try {
    const { chunks, embedder } = await loadStore();
    return {
      docs: new Set(chunks.map((c) => c.doc)).size,
      chunks: chunks.length,
      embedder,
      aiAvailable: aiAvailable(),
    };
  } catch (err) {
    console.error("[rag] storeInfo failed:", err);
    return { docs: 0, chunks: 0, embedder: "local", aiAvailable: aiAvailable() };
  }
}

/** Build the grounded context block injected into grounded LLM prompts. */
export function contextBlock(hits: RagHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .map((h, i) => `[${i + 1}] ${h.title} (source: ${h.doc}.md)\n${h.excerpt}`)
    .join("\n\n");
}
