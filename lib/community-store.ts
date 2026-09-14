/**
 * Community-response store: confirmations ("still present / cleared") and
 * comments. Both are persisted per-user so a refresh can never re-submit.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Incident } from "./types";

const DATA_PATH = path.join(process.cwd(), ".hillsense-community.json");

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

async function load(): Promise<CommunityDb> {
  if (db) return db;
  try {
    db = { ...EMPTY, ...(JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as CommunityDb) };
  } catch {
    db = { ...EMPTY };
  }
  return db;
}

async function persist(): Promise<void> {
  if (!db) return;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(db, null, 2));
  } catch {
    /* best-effort */
  }
}

/* ----------------------------- confirmations ----------------------------- */

export function hasConfirmed(incidentId: string, userId: string): ConfirmationRecord | null {
  if (!db) return null;
  return (
    db.confirmations.find((c) => c.incident_id === incidentId && c.user_id === userId) ?? null
  );
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
  const d = await load();
  const existing = d.confirmations.find(
    (c) => c.incident_id === incidentId && c.user_id === userId,
  );
  if (existing) return { record: existing, already: true };
  const record: ConfirmationRecord = {
    incident_id: incidentId,
    user_id: userId,
    response,
    at: new Date().toISOString(),
  };
  d.confirmations.push(record);
  await persist();
  return { record, already: false };
}

export function listConfirmations(incidentId: string): ConfirmationRecord[] {
  if (!db) return [];
  return db.confirmations.filter((c) => c.incident_id === incidentId);
}

/** Recount aggregate yes/no from the persisted per-user records. */
export function confirmationCounts(incidentId: string): { yes: number; no: number } {
  const list = listConfirmations(incidentId);
  return {
    yes: list.filter((c) => c.response === "yes").length,
    no: list.filter((c) => c.response === "no").length,
  };
}

/* -------------------------------- comments -------------------------------- */

const MAX_COMMENTS_PER_INCIDENT = 200;

export function listComments(incidentId: string): CommentRecord[] {
  if (!db) return [];
  return db.comments
    .filter((c) => c.incident_id === incidentId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

const REPEAT_WINDOW_MS = 60_000; // basic duplicate-protection window

export async function addComment(
  incidentId: string,
  userId: string,
  authorName: string,
  body: string,
): Promise<{ ok: true; comment: CommentRecord } | { ok: false; error: string }> {
  const d = await load();
  const clean = body.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!clean) return { ok: false, error: "Comment cannot be empty." };

  const now = Date.now();
  const dup = d.comments.find(
    (c) =>
      c.incident_id === incidentId &&
      c.user_id === userId &&
      c.body.toLowerCase() === clean.toLowerCase() &&
      now - new Date(c.created_at).getTime() < REPEAT_WINDOW_MS,
  );
  if (dup) return { ok: false, error: "You just posted that comment." };

  const recentByUser = d.comments.filter(
    (c) => c.user_id === userId && now - new Date(c.created_at).getTime() < REPEAT_WINDOW_MS,
  );
  if (recentByUser.length >= 3) {
    return { ok: false, error: "You're posting too quickly. Please wait a moment." };
  }

  if (d.comments.filter((c) => c.incident_id === incidentId).length >= MAX_COMMENTS_PER_INCIDENT) {
    return { ok: false, error: "This incident has reached its comment limit." };
  }

  const comment: CommentRecord = {
    id: `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    incident_id: incidentId,
    user_id: userId,
    author_name: authorName,
    body: clean,
    created_at: new Date().toISOString(),
  };
  d.comments.push(comment);
  await persist();
  return { ok: true, comment };
}

export async function deleteComment(
  commentId: string,
  userId: string,
): Promise<boolean> {
  const d = await load();
  const idx = d.comments.findIndex((c) => c.id === commentId && c.user_id === userId);
  if (idx === -1) return false;
  d.comments.splice(idx, 1);
  await persist();
  return true;
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
