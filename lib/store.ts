/**
 * Tiny JSON-file persistence for incidents (demo-grade, no external DB).
 * Safe for the single-user demo workload this app targets.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { seedIncidents } from "./seed-incidents";
import { kvEnabled, dataDir, kvGetJson, kvSetJson, kvMutate } from "./kv";
import type { Incident, IncidentFilters } from "./types";

const DATA_PATH = path.join(dataDir, ".hillsense-incidents.json");
const KV_KEY = "hillsense:incidents:v1";
/** Redis mode: refresh the read cache at most this often (mutations always re-read). */
const READ_CACHE_TTL_MS = 3_000;

let cache: Incident[] | null = null;
let cacheMtimeMs = 0;
let cacheAt = 0;

/** Invalidate the in-memory cache when the file was changed externally
 *  (manual data fixes, other processes) so edits show without a restart. */
async function cacheStale(): Promise<boolean> {
  if (kvEnabled) return cache === null || Date.now() - cacheAt > READ_CACHE_TTL_MS;
  try {
    const st = await fs.stat(DATA_PATH);
    return cache !== null && st.mtimeMs > cacheMtimeMs + 1;
  } catch {
    return cache !== null; // file gone — force reload/reseed
  }
}

/**
 * Backfill fields added after the first schema, so persisted files from an
 * earlier build keep working without a manual reset.
 */
function migrate(raw: Incident[]): Incident[] {
  return raw.map((i) => ({
    ...i,
    verification: i.verification ?? (i.needs_verification ? "needs_review" : "verified"),
    verification_reasons: i.verification_reasons ?? [],
    publication: i.publication ?? (i.needs_verification ? "review_only" : "public"),
    reporter_label: i.reporter_label ?? (i.origin === "seed" ? "Demo dataset" : "Community report"),
    last_confirmed_at: i.last_confirmed_at ?? i.created_at,
    confirmations_yes: i.confirmations_yes ?? 0,
    confirmations_no: i.confirmations_no ?? 0,
    status_history: i.status_history ?? [{ status: i.status, at: i.created_at }],
  }));
}

async function load(): Promise<Incident[]> {
  if (cache && !(await cacheStale())) return cache;
  if (kvEnabled) {
    const doc = await kvGetJson<Incident[]>(KV_KEY);
    cache = Array.isArray(doc) ? migrate(doc) : seedIncidents();
    if (!Array.isArray(doc)) await kvSetJson(KV_KEY, cache); // first boot — seed
    cacheAt = Date.now();
    return cache;
  }
  try {
    const raw = JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as Incident[];
    if (Array.isArray(raw)) {
      cache = migrate(raw);
      cacheMtimeMs = (await fs.stat(DATA_PATH)).mtimeMs;
      return cache;
    }
  } catch {
    /* first boot — seed below */
  }
  cache = seedIncidents();
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(cache, null, 2));
    cacheMtimeMs = (await fs.stat(DATA_PATH)).mtimeMs;
  } catch {
    /* persistence best-effort */
  }
  return cache;
}

async function persist(list: Incident[]): Promise<void> {
  cache = list;
  cacheAt = Date.now();
  if (kvEnabled) {
    await kvSetJson(KV_KEY, list);
    return;
  }
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(list, null, 2));
    cacheMtimeMs = (await fs.stat(DATA_PATH)).mtimeMs;
  } catch {
    /* persistence best-effort */
  }
}

export async function listIncidents(
  f: IncidentFilters & { public?: boolean; lat?: number; lng?: number; radiusKm?: number } = {},
): Promise<Incident[]> {
  let list = await load();
  if (f.severity) list = list.filter((i) => i.severity === f.severity);
  if (f.type) list = list.filter((i) => i.incident_type === f.type);
  if (f.status) list = list.filter((i) => i.status === f.status);
  if (f.location)
    list = list.filter(
      (i) => i.location.toLowerCase() === f.location!.trim().toLowerCase(),
    );
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(
      (i) =>
        i.description.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q),
    );
  }
  // Public feed: only AI-verified or seeded incidents are published.
  if (f.public) {
    list = list.filter(
      (i) => i.publication === "public" && i.verification === "verified" && i.status !== "Resolved",
    );
  }
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function getIncident(id: string): Promise<Incident | null> {
  const list = await load();
  return list.find((i) => i.id === id) ?? null;
}

export async function addIncident(input: Omit<Incident, "id"> & { verification?: Incident["verification"]; verification_reasons?: string[]; publication?: Incident["publication"]; reporter_label?: string }): Promise<Incident> {
  // Redis mode: allocate the id and insert inside one atomic CAS mutation.
  if (kvEnabled) {
    return kvMutate<Incident[], Incident>(
      KV_KEY,
      seedIncidents,
      (list) => {
        const maxNum = list.reduce((m, i) => {
          const n = Number.parseInt(i.id.replace("HS-", ""), 10);
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 1000);
        const incident: Incident = { ...input, id: `HS-${maxNum + 1}` };
        return { doc: [incident, ...list], result: incident };
      },
    );
  }
  const list = await load();
  const maxNum = list.reduce((m, i) => {
    const n = Number.parseInt(i.id.replace("HS-", ""), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  const incident: Incident = { ...input, id: `HS-${maxNum + 1}` };
  await persist([incident, ...list]);
  return incident;
}

export async function updateStatus(
  id: string,
  status: Incident["status"],
  statusHistory?: Incident["status_history"],
): Promise<Incident | null> {
  if (kvEnabled) {
    return kvMutate<Incident[], Incident | null>(
      KV_KEY,
      seedIncidents,
      (list) => {
        const idx = list.findIndex((i) => i.id === id);
        if (idx === -1) return { doc: list, result: null };
        const updated: Incident = {
          ...list[idx],
          status,
          ...(statusHistory ? { status_history: statusHistory } : {}),
        };
        const next = [...list];
        next[idx] = updated;
        return { doc: next, result: updated };
      },
    );
  }
  const list = await load();
  const idx = list.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  const updated = {
    ...list[idx],
    status,
    ...(statusHistory ? { status_history: statusHistory } : {}),
  };
  const next = [...list];
  next[idx] = updated;
  await persist(next);
  return updated;
}

export function nextIncidentId(): string {
  return `HS-${Date.now().toString(36)}`;
}

/**
 * Community "is this hazard still present?" confirmation.
 * Counts come from the per-user community store (one response per user),
 * so the aggregates can never be inflated by repeat clicks.
 */
export async function confirmIncident(
  id: string,
  stillPresent: boolean,
  counts?: { yes: number; no: number },
): Promise<Incident | null> {
  if (kvEnabled) {
    return kvMutate<Incident[], Incident | null>(
      KV_KEY,
      seedIncidents,
      (list) => {
        const idx = list.findIndex((i) => i.id === id);
        if (idx === -1) return { doc: list, result: null };
        const now = new Date().toISOString();
        const cur = list[idx];
        const yesCount = counts ? counts.yes : (cur.confirmations_yes ?? 0) + (stillPresent ? 1 : 0);
        const noCount = counts ? counts.no : (cur.confirmations_no ?? 0) + (stillPresent ? 0 : 1);
        const resolve = !stillPresent && noCount > yesCount + 1 && cur.status === "Open";
        const updated: Incident = {
          ...cur,
          last_confirmed_at: stillPresent ? now : cur.last_confirmed_at,
          confirmations_yes: yesCount,
          confirmations_no: noCount,
          status: resolve ? "Resolved" : cur.status,
          status_history: resolve ? [...(cur.status_history ?? []), { status: "Resolved" as const, at: now }] : cur.status_history,
        };
        const next = [...list];
        next[idx] = updated;
        return { doc: next, result: updated };
      },
    );
  }
  const list = await load();
  const idx = list.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  const cur = list[idx];
  const yesCount = counts ? counts.yes : (cur.confirmations_yes ?? 0) + (stillPresent ? 1 : 0);
  const noCount = counts ? counts.no : (cur.confirmations_no ?? 0) + (stillPresent ? 0 : 1);
  const updated: Incident = {
    ...cur,
    last_confirmed_at: stillPresent ? now : cur.last_confirmed_at,
    confirmations_yes: yesCount,
    confirmations_no: noCount,
    // Majority of "cleared" responses auto-resolve the public alert.
    status:
      !stillPresent && noCount > (yesCount + 1) && cur.status === "Open" ? "Resolved" : cur.status,
    status_history:
      !stillPresent && noCount > (yesCount + 1) && cur.status === "Open"
        ? [...(cur.status_history ?? []), { status: "Resolved" as const, at: now }]
        : cur.status_history,
  };
  const next = [...list];
  next[idx] = updated;
  await persist(next);
  return updated;
}
