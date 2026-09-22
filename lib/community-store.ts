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
import { kvMode, dataDir, kvLoadDoc, kvMutate, requirePersistentStore } from "./kv";

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
  user_id: string; // links the comment to its author (resolution happens at read time)
  author_name: string; // snapshot at post time; the API re-resolves from the live profile
  body: string;
  created_at: string;
  client_id?: string; // outbox idempotency key — replay protection for synced offline comments
}

export interface CommentLikeRecord {
  comment_id: string;
  user_id: string;
  at: string;
}

interface CommunityDb {
  confirmations: ConfirmationRecord[];
  comments: CommentRecord[];
  comment_likes: CommentLikeRecord[];
}

const EMPTY: CommunityDb = { confirmations: [], comments: [], comment_likes: [] };
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
    const d = await kvLoadDoc<CommunityDb>(KV_KEY, async () => ({ ...EMPTY }));
    return migrate(d);
  }
  if (db) return db;
  const d = migrate(await fallback());
  cacheSet(d);
  return d;
}

/**
 * Storage-level hygiene: a user may have at most ONE confirmation per incident.
 * The write path enforces this inside the atomic mutation; migrate() also
 * collapses any historical duplicates (earliest response wins) so counts can
 * never be inflated by pre-existing data.
 */
function migrate(d: CommunityDb): CommunityDb {    const seen = new Set<string>();
    const confirmations: ConfirmationRecord[] = [];
    for (const c of d.confirmations ?? []) {
      const key = `${c.incident_id}\u0000${c.user_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      confirmations.push(c);
    }
    const likeSeen = new Set<string>();
    const comment_likes: CommentLikeRecord[] = [];
    for (const l of d.comment_likes ?? []) {
      const key = `${l.comment_id}\u0000${l.user_id}`;
      if (likeSeen.has(key)) continue;
      likeSeen.add(key);
      comment_likes.push(l);
    }
    if (confirmations.length === (d.confirmations ?? []).length &&
        comment_likes.length === (d.comment_likes ?? []).length) return d;
    return { ...d, confirmations, comment_likes };
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
  // Confirmations/comments must never land in serverless tmpfs (lost between
  // requests on Vercel). Local dev file mode is fine.
  requirePersistentStore();
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

/** Time of the most recent community response for the incident, if any. */
export async function latestConfirmationAt(incidentId: string): Promise<string | null> {
  const list = await listConfirmations(incidentId);
  if (list.length === 0) return null;
  return list.reduce((latest, c) => (c.at > latest ? c.at : latest), list[0].at);
}

/** Recount aggregate yes/no from the persisted per-user records. */
export async function confirmationCounts(
  incidentId: string,
  opts: { excludeUserId?: string } = {},
): Promise<{ yes: number; no: number }> {
  const list = await listConfirmations(incidentId);
  const filtered = opts.excludeUserId
    ? list.filter((c) => c.user_id !== opts.excludeUserId)
    : list;
  return {
    yes: filtered.filter((c) => c.response === "yes").length,
    no: filtered.filter((c) => c.response === "no").length,
  };
}

/* -------------------------------- comments -------------------------------- */

const MAX_COMMENTS_PER_INCIDENT = 200;
const REPEAT_WINDOW_MS = 60_000; // basic duplicate-protection window

/** Comment totals for a batch of incidents (feed annotation). Never throws. */
export async function commentCountsFor(incidents: { id: string }[]): Promise<Record<string, number>> {
  try {
    const d = await loadDb();
    const counts: Record<string, number> = {};
    for (const i of incidents) counts[i.id] = 0;
    for (const c of d.comments) {
      if (counts[c.incident_id] !== undefined) counts[c.incident_id] += 1;
    }
    return counts;
  } catch {
    return {};
  }
}

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
  /** Client-generated idempotency key from the offline outbox (optional). */
  clientId?: string,
): Promise<{ ok: true; comment: CommentRecord } | { ok: false; error: string }> {
  const clean = body.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!clean) return { ok: false, error: "Comment cannot be empty." };

  return mutate<{ ok: boolean; comment?: CommentRecord; error?: string }>((d) => {
    const now = Date.now();
    // Idempotent replay: a synced offline comment retried with the same
    // client-generated key returns the original record, never a duplicate.
    if (clientId) {
      const replay = d.comments.find((c) => c.client_id === clientId);
      if (replay) return { doc: d, result: { ok: true, comment: replay } };
    }
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
      ...(clientId ? { client_id: clientId } : {}),
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

/**
 * Attach live profile info (display name, avatar) to a batch of comments.
 * The profile is the source of truth — the stored author_name is only a
 * historical snapshot, so a rename updates everywhere a comment shows.
 * Only public fields are attached; phone/email never enter comment records.
 */
export function withAuthorProfiles<T extends CommentRecord>(
  comments: T[],
  resolve: (userId: string) => { display_name: string; avatar_url?: string | null } | null,
): (T & { author_display_name: string; author_initials: string; author_avatar_url?: string | null })[] {
  return comments.map((c) => {
    const profile = resolve(c.user_id);
    const name = profile?.display_name || c.author_name || "HillSense user";
    return {
      ...c,
      author_display_name: name,
      author_initials: name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]!.toUpperCase())
        .join("") || "H",
      ...(profile?.avatar_url ? { author_avatar_url: profile.avatar_url } : {}),
    };
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

/* ---------------------------- comment likes ----------------------------- */

export async function hasLikedComment(commentId: string, userId: string): Promise<CommentLikeRecord | null> {
  const d = await loadDb();
  return d.comment_likes.find((l) => l.comment_id === commentId && l.user_id === userId) ?? null;
}

export async function toggleCommentLike(
  commentId: string,
  userId: string,
  /** Client-generated idempotency key from the offline outbox (optional). */
  clientId?: string,
): Promise<{ ok: true; liked: boolean; count: number } | { ok: false; error: string }> {
  return mutate<{ ok: boolean; liked?: boolean; count?: number; error?: string }>((d) => {
    // Idempotent replay for offline outbox retries.
    if (clientId) {
      const existing = d.comment_likes.find((l) => l.user_id === userId && l.comment_id === commentId);
      if (existing) return { doc: d, result: { ok: true, liked: true, count: countFor(d, commentId) } };
    }
    const idx = d.comment_likes.findIndex((l) => l.comment_id === commentId && l.user_id === userId);
    if (idx >= 0) {
      // Unlike — remove the one record for this user.
      const likes = [...d.comment_likes];
      likes.splice(idx, 1);
      return { doc: { ...d, comment_likes: likes }, result: { ok: true, liked: false, count: countFor(d, commentId) - 1 } };
    }
    const like: CommentLikeRecord = {
      comment_id: commentId,
      user_id: userId,
      at: new Date().toISOString(),
    };
    return { doc: { ...d, comment_likes: [...d.comment_likes, like] }, result: { ok: true, liked: true, count: countFor(d, commentId) + 1 } };
  }).then((r) =>
    r.ok
      ? { ok: true as const, liked: r.liked as boolean, count: r.count as number }
      : { ok: false as const, error: r.error ?? "Could not record your reaction." },
  );
}

function countFor(d: CommunityDb, commentId: string): number {
  return d.comment_likes.filter((l) => l.comment_id === commentId).length;
}

export async function likeCountsFor(comments: { id: string }[]): Promise<Record<string, number>> {
  try {
    const d = await loadDb();
    const counts: Record<string, number> = {};
    for (const c of comments) counts[c.id] = 0;
    for (const l of d.comment_likes ?? []) {
      if (counts[l.comment_id] !== undefined) counts[l.comment_id] += 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/** Wipe all confirmations, comments and likes (admin reset). */
export async function resetCommunity(): Promise<void> {
  if (kvMode !== "file") {
    await kvMutate<CommunityDb, void>(KV_KEY, async () => ({ ...EMPTY }), async () => ({ doc: { ...EMPTY }, result: undefined }));
    return;
  }
  cacheSet({ ...EMPTY });
  await persistFile({ ...EMPTY });
}