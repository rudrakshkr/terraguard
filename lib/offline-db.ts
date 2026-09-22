"use client";

/**
 * Client-side offline storage (IndexedDB).
 *
 * Two stores:
 *  - "incidents" — last-seen copies of the incident list and detail pages, so
 *    previously loaded hazards stay readable with no connectivity.
 *  - "outbox"    — queued user actions created offline (F6) with idempotency
 *    keys and sync state.
 *
 * The database opens lazily and never throws into the UI: every helper
 * resolves (possibly with null / empty results) when storage is unavailable,
 * e.g. private-mode browsers.
 */

const DB_NAME = "hillsense-offline";
const DB_VERSION = 2;
const INCIDENTS = "incidents";
const OUTBOX = "outbox";

export interface CachedList {
  key: string; // e.g. "public-list"
  incidents: unknown[];
  fetched_at: string;
}

export interface CachedDetail {
  id: string;
  user_id?: string;
  incident: unknown;
  comments: unknown[];
  my_confirmation?: { response: "yes" | "no"; at: string } | null;
  fetched_at: string;
}

export type OutboxKind = "confirmation" | "comment" | "report" | "profile";
export type OutboxState = "pending" | "syncing" | "synced" | "failed";

export interface OutboxItem {
  id: string; // client-generated idempotency key (UUID)
  kind: OutboxKind;
  incident_id?: string;
  payload: unknown;
  created_at: string;
  state: OutboxState;
  attempts: number;
  last_error?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(INCIDENTS)) db.createObjectStore(INCIDENTS, { keyPath: "key" });
        if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, mode);
      const store = tx.objectStore(name);
      const req = fn(store);
      let result: T | null = null;
      if (req && "onsuccess" in (req as IDBRequest)) {
        (req as IDBRequest).onsuccess = () => {
          result = (req as IDBRequest).result as T;
        };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/* ------------------------------ incidents ------------------------------ */

export async function putCachedList(incidents: unknown[]): Promise<void> {
  const rec: CachedList = { key: "public-list", incidents, fetched_at: new Date().toISOString() };
  await withStore<void>(INCIDENTS, "readwrite", (s) => s.put(rec));
}

export async function getCachedList(): Promise<CachedList | null> {
  return withStore<CachedList>(INCIDENTS, "readonly", (s) => s.get("public-list"));
}

export async function putCachedDetail(
  id: string,
  incident: unknown,
  comments: unknown[],
  userId?: string,
  myConfirmation?: { response: "yes" | "no"; at: string } | null,
): Promise<void> {
  const rec: CachedDetail = {
    id,
    ...(userId ? { user_id: userId } : {}),
    incident,
    comments,
    ...(myConfirmation !== undefined ? { my_confirmation: myConfirmation } : {}),
    fetched_at: new Date().toISOString(),
  };
  const key = `detail:${userId ?? "public"}:${id}`;
  await withStore<void>(INCIDENTS, "readwrite", (s) => s.put({ ...rec, key }));
}

export async function getCachedDetail(id: string, userId?: string): Promise<CachedDetail | null> {
  const key = `detail:${userId ?? "public"}:${id}`;
  const current = await withStore<CachedDetail>(INCIDENTS, "readonly", (s) => s.get(key));
  return current;
}

/* -------------------------------- outbox -------------------------------- */

export function newOutboxId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `ob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export async function enqueue(item: OutboxItem): Promise<void> {
  await withStore<void>(OUTBOX, "readwrite", (s) => s.put(item));
}

export async function getOutboxItem(id: string): Promise<OutboxItem | null> {
  return withStore<OutboxItem>(OUTBOX, "readonly", (s) => s.get(id));
}

export async function updateOutboxItem(item: OutboxItem): Promise<void> {
  await withStore<void>(OUTBOX, "readwrite", (s) => s.put(item));
}

export async function listOutbox(): Promise<OutboxItem[]> {
  const all = await withStore<OutboxItem[]>(OUTBOX, "readonly", (s) => s.getAll());
  return (all ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function listPendingOutbox(): Promise<OutboxItem[]> {
  // Include stale "syncing" records left behind by a browser/tab crash. The
  // sync engine has an in-process lock, so live syncing still cannot overlap.
  return (await listOutbox()).filter(
    (i) => i.state === "pending" || i.state === "syncing" || i.state === "failed",
  );
}

export async function deleteOutboxItem(id: string): Promise<void> {
  await withStore<void>(OUTBOX, "readwrite", (s) => s.delete(id));
}