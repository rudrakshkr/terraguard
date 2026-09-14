/**
 * Community-response store: confirmations ("still present / cleared") and
 * comments. Both are persisted per-user so a refresh can never re-submit.
 *
 * Storage backends (lib/kv.ts):
 *  - Redis mode (Upstash configured): every mutation runs as an atomic
 *    compare-and-set loop, so two phones confirming the same incident at the
 *    same moment on different serverless instances can never both "win".
 *  - File mode (default): JSON file, single process.
 */

import fs from "node:fs/promises";
import type { Incident } from "./types";
import { kvMode, dataDir, kvLoadDoc, kvMutate } from "./kv";

const DATA_PATH = `${dataDir}/.hillsense-community.json`.replace("//", "/");
const KV_KEY = "hillsense:community:v1";

export interface ConfirmationRecord {
  incident_id: string;
  user_id: string;
  response: "yes" | "no"; // yes = still present, no = cleared
  at: string; // ISO
}

export interface CommentRecord {
  id: string;
  incident_id: string;
  user_id: string;
  author_name: string; // display name / first name only — never phone
  body: string;
  created_at: string;
}

interface CommunityDb {
  confirmations: ConfirmationRecord[];
  comments: CommentRecord[];
}

const EMPTY: CommunityDb = { confirmations: [], comments: [] };
let db: CommunityDb | null = null;

async function fallback(): Promise<CommunityDb> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as CommunityDb) };
  } catch {
    return { ...EMPTY };
  }
}

/** File mode: keep the in-memory mirror in sync; Redis mode leaves it null. */
function cacheSet(d: CommunityDb): void {
  db = d;
}

async function persistFile(d: CommunityDb): Promise<void> {
  if (kvMode !== "file") return;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(d, null, 2));
  } catch {
    /* best-effort */
  }
}

/* ------------------------------- data access ------------------------------ */

async function loadDb(): Promise<CommunityDb> {
  if (kvMode !== "file") {
    return kvLoadDoc<CommunityDb>(KV_KEY, async () => ({ ...EMPTY }));
  }
  if (db) return db;
  const d = await fallback();
  cacheSet(d);
  return d;
}

/**
 * Atomic mutation shared by both backends. File mode mutates the in-memory
 * document then persists; Redis mode runs the same pure function inside the
 * compare-and-set retry loop. `fn` must be pure (it may run more than once).
 */
async function mutate<R>(fn: (d: CommunityDb) => { doc: CommunityDb; result: R }): Promise<R> {
  if (kvMode !== "file") {
    return kvMutate<CommunityDb, R>(KV_KEY, async () => ({ ...EMPTY }), async (cur) => fn(cur));
  }
  const cur = await loadDb();
  const { doc, result } = fn(cur);
  cacheSet(doc);
  await persistFile(doc);
  return result;
}

/* ----------------------------- confirmations ----------------------------- */

export async function hasConfirmed(incidentId: string, userId: string): Promise<ConfirmationRecord | null> {
  const d = await loadDb();
  return d.confirmations.find((c) => c.incident_id === incidentId && c.user_id === userId) ?? null;
}

/**
 * Record a one-time confirmation. Returns `already: true` when this user has
 * already responded to this incident — nothing is mutated in that case.
 */
export async function recordConfirmation(
  incidentId: string,
  userId: string,
  response: "yes" | "no",
): Promise<{ record: ConfirmationRecord; already: false } | { record: ConfirmationRecord; already: true }> {
  return mutate<{
    record: ConfirmationRecord;
    already: boolean;
  }>((d) => {
    const existing = d.confirmations.find(
      (c) => c.incident_id === incidentId && c.user_id === userId,
    );
    if (existing) return { doc: d, result: { record: existing, already: true } };
    const record: ConfirmationRecord = {
      incident_id: incidentId,
      user_id: userId,
      response,
      at: new Date().toISOString(),
    };
    return {
      doc: { ...d, confirmations: [...d.confirmations, record] },
      result: { record, already: false },
    };
  }) as Promise<{ record: ConfirmationRecord; already: false } | { record: ConfirmationRecord; already: true }>;
}

export async function listConfirmations(incidentId: string): Promise<ConfirmationRecord[]> {
  const d = await loadDb();
  return d.confirmations.filter((c) => c.incident_id === incidentId);
}

/** Recount aggregate yes/no from the persisted per-user records. */
export async function confirmationCounts(incidentId: string): Promise<{ yes: number; no: number }> {
  const list = await listConfirmations(incidentId);
  return {
    yes: list.filter((c) => c.response === "yes").length,
    no: list.filter((c) => c.response === "no").length,
  };
}

/* -------------------------------- comments -------------------------------- */

const MAX_COMMENTS_PER_INCIDENT = 200;
const REPEAT_WINDOW_MS = 60_000; // basic duplicate-protection window

export async function listComments(incidentId: string): Promise<CommentRecord[]> {
  const d = await loadDb();
  return d.comments
    .filter((c) => c.incident_id === incidentId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function addComment(
  incidentId: string,
  userId: string,
  authorName: string,
  body: string,
): Promise<{ ok: true; comment: CommentRecord } | { ok: false; error: string }> {
  const clean = body.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!clean) return { ok: false, error: "Comment cannot be empty." };

  return mutate<{ ok: boolean; comment?: CommentRecord; error?: string }>((d) => {
    const now = Date.now();
    const dup = d.comments.find(
      (c) =>
        c.incident_id === incidentId &&
        c.user_id === userId &&
        c.body.toLowerCase() === clean.toLowerCase() &&
        now - new Date(c.created_at).getTime() < REPEAT_WINDOW_MS,
    );
    if (dup) return { doc: d, result: { ok: false, error: "You just posted that comment." } };

    const recentByUser = d.comments.filter(
      (c) => c.user_id === userId && now - new Date(c.created_at).getTime() < REPEAT_WINDOW_MS,
    );
    if (recentByUser.length >= 3) {
      return { doc: d, result: { ok: false, error: "You're posting too quickly. Please wait a moment." } };
    }

    if (d.comments.filter((c) => c.incident_id === incidentId).length >= MAX_COMMENTS_PER_INCIDENT) {
      return { doc: d, result: { ok: false, error: "This incident has reached its comment limit." } };
    }

    const comment: CommentRecord = {
      id: `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      incident_id: incidentId,
      user_id: userId,
      author_name: authorName,
      body: clean,
      created_at: new Date().toISOString(),
    };
    return {
      doc: { ...d, comments: [...d.comments, comment] },
      result: { ok: true, comment },
    };
  }).then((r) =>
    r.ok ? { ok: true as const, comment: r.comment! } : { ok: false as const, error: r.error ?? "Could not post the comment." },
  );
}

export async function deleteComment(commentId: string, userId: string): Promise<boolean> {
  return mutate<boolean>((d) => {
    const idx = d.comments.findIndex((c) => c.id === commentId && c.user_id === userId);
    if (idx === -1) return { doc: d, result: false };
    const comments = [...d.comments];
    comments.splice(idx, 1);
    return { doc: { ...d, comments }, result: true };
  });
}

/** Number of distinct community reports on the same incident (corroboration). */
export function corroboratingReportsFor(incident: Incident, pool: Incident[]): number {
  return pool.filter(
    (p) =>
      p.id !== incident.id &&
      p.incident_type === incident.incident_type &&
      Math.abs(new Date(p.created_at).getTime() - new Date(incident.created_at).getTime()) <
        6 * 3600_000,
  ).length;
}

/** Wipe all confirmations and comments (admin reset). */
export async function resetCommunity(): Promise<void> {
  if (kvMode !== "file") {
    await kvMutate<CommunityDb, void>(KV_KEY, async () => ({ ...EMPTY }), async () => ({ doc: { ...EMPTY }, result: undefined }));
    return;
  }
  cacheSet({ ...EMPTY });
  await persistFile({ ...EMPTY });
}
