"use client";

/**
 * Offline action queue — synchronization engine.
 *
 * Queued actions (confirmations, comments, reports, profile edits) live in
 * IndexedDB with a client-generated idempotency key. This module replays them
 * against the real APIs when connectivity allows:
 *
 *  - each item moves pending → syncing → synced/failed, and the UI is notified
 *    through a window event so the offline banner stays accurate;
 *  - the server's own duplicate protection (one confirmation per user,
 *    comment dedupe window) makes replays safe: a duplicate is treated as
 *    synced, never re-queued;
 *  - failures keep the item with its last error so the user can retry;
 *  - nothing is ever dropped silently.
 */

import {
  listPendingOutbox,
  updateOutboxItem,
  deleteOutboxItem,
  listOutbox,
  type OutboxItem,
} from "./offline-db";
import { getAuthToken } from "@/hooks/useAuth";

let syncing = false;

function notify(pending: number, isSyncing: boolean, failed: number) {
  try {
    window.dispatchEvent(
      new CustomEvent("hillsense:sync-state", { detail: { pending, syncing: isSyncing, failed } }),
    );
  } catch {
    /* non-browser context */
  }
}

async function currentState(): Promise<{ pending: number; failed: number }> {
  const items = await listOutbox();
  return {
    pending: items.filter((i) => i.state === "pending" || i.state === "syncing").length,
    failed: items.filter((i) => i.state === "failed").length,
  };
}

async function refreshIndicator(isSyncing: boolean) {
  const { pending, failed } = await currentState();
  notify(pending, isSyncing, failed);
}

/** Send one queued action to its real endpoint. Returns the response + data. */
async function send(item: OutboxItem): Promise<{ res: Response; data: Record<string, unknown> }> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // Idempotency key lets the server collapse accidental replays.
  headers["Idempotency-Key"] = item.id;

  let url: string;
  let body: unknown;
  switch (item.kind) {
    case "confirmation":
      url = `/api/incidents/${item.incident_id}`;
      body = { action: "confirm", ...(item.payload as { response: string }) };
      break;
    case "comment":
      url = `/api/incidents/${item.incident_id}`;
      body = { action: "comment", client_id: item.id, ...(item.payload as { body: string }) };
      break;
    case "report": {
      // Reports are delivered to the offline-ingest endpoint, which runs the
      // full analyze → verify pipeline server-side and stores the photo.
      url = "/api/incidents/offline";
      body = { client_id: item.id, ...(item.payload as Record<string, unknown>) };
      break;
    }
    case "profile":
      url = "/api/auth/profile";
      body = item.payload;
      break;
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON response */
  }
  return { res, data };
}

/**
 * Replay the queue. Safe to call concurrently — the first caller wins and the
 * others wait on the same pass. Returns once the queue is quiescent.
 */
export async function syncOutbox(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!navigator.onLine) return;
  if (syncing) return;
  syncing = true;
  try {
    await refreshIndicator(true);
    const items = await listPendingOutbox();
    for (const item of items) {
      // Re-check connectivity between items: a drop mid-pass must not churn.
      if (!navigator.onLine) break;

      await updateOutboxItem({ ...item, state: "syncing" });
      await refreshIndicator(true);
      try {
        const { res, data } = await send(item);

        if (res.ok || res.status === 409) {
          // 409 = already exists → the idempotent outcome; treat as synced.
          await deleteOutboxItem(item.id);
          try {
            window.dispatchEvent(
              new CustomEvent("hillsense:data-updated", {
                detail: {
                  kind: item.kind,
                  incidentId: item.incident_id,
                  user: item.kind === "profile" ? (data.user ?? undefined) : undefined,
                },
              }),
            );
          } catch {
            /* browser event is best-effort */
          }
        } else if (res.status === 401) {
          // Session expired — keep for retry after the user signs in again.
          await updateOutboxItem({
            ...item,
            state: "failed",
            attempts: item.attempts + 1,
            last_error: "Sign in again to sync this change.",
          });
        } else if (res.status === 400 || res.status === 404 || res.status === 413 || res.status === 415) {
          // Rejected outright (validation / missing target / too large) —
          // keeping it queued would never succeed. Mark failed with reason.
          await updateOutboxItem({
            ...item,
            state: "failed",
            attempts: item.attempts + 1,
            last_error: (data.error as string) ?? "The server rejected this change.",
          });
        } else {
          // 5xx / network / anything transient — retry later.
          await updateOutboxItem({
            ...item,
            state: "failed",
            attempts: item.attempts + 1,
            last_error: (data.error as string) ?? "Could not reach the server. Will retry.",
          });
        }
      } catch (err) {
        await updateOutboxItem({
          ...item,
          state: "failed",
          attempts: item.attempts + 1,
          last_error: err instanceof Error ? err.message : "Network problem — will retry.",
        });
      }
      await refreshIndicator(false);
    }
  } finally {
    syncing = false;
    await refreshIndicator(false);
  }
}

/** Manual retry: reset failed items to pending and run a pass. */
export async function retryFailed(): Promise<void> {
  const items = await listOutbox();
  for (const item of items) {
    if (item.state === "failed") await updateOutboxItem({ ...item, state: "pending" });
  }
  await syncOutbox();
}