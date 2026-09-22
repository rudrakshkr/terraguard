/**
 * Small binary store for user profile and report photos.
 *
 * Reuses the existing storage stack (lib/kv.ts) rather than adding a new one:
 *  - Blob mode (Vercel Blob configured): the image is stored as a blob and its
 *    URL is saved on the user record.
 *  - File mode (local dev / demo): the image is stored inside the same
 *    server-side JSON document store as a data URL and served back through
 *    /api/uploads/[id]. Size is capped well below any document-size concern.
 *
 * Images are downscaled client-side before upload; the server enforces a hard
 * 1.5 MB limit on the raw payload either way.
 */

import fs from "node:fs/promises";
import { kvMode, dataDir, kvLoadDoc, kvMutate, requirePersistentStore } from "./kv";

const DATA_PATH = `${dataDir}/.hillsense-uploads.json`.replace("//", "/");
const KV_KEY = "hillsense:uploads:v1";

export const MAX_AVATAR_BYTES = 1_500_000;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface UploadRecord {
  type: string;
  uploaded_at: string;
  /** File mode: the image bytes themselves, kept in the JSON document store. */
  data?: string; // data URL
  /** Blob mode: the object pathname inside the store, plus how to read it back. */
  blob_path?: string;
  blob_access?: "public" | "private";
}

interface UploadsDb {
  avatars: Record<string, UploadRecord>; // id → record
}

const EMPTY: UploadsDb = { avatars: {} };
let cache: UploadsDb | null = null;

async function fallback(): Promise<UploadsDb> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as UploadsDb) };
  } catch {
    return { ...EMPTY };
  }
}

async function persistFile(d: UploadsDb): Promise<void> {
  if (kvMode !== "file") return;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(d));
  } catch {
    /* best-effort */
  }
}

async function mutate<R>(fn: (d: UploadsDb) => { doc: UploadsDb; result: R }): Promise<R> {
  if (kvMode !== "file") {
    return kvMutate<UploadsDb, R>(KV_KEY, async () => ({ ...EMPTY }), async (cur) => fn(cur));
  }
  requirePersistentStore();
  const cur = cache ?? (await fallback());
  const { doc, result } = fn(cur);
  cache = doc;
  await persistFile(doc);
  return result;
}

function isBlobMode(): boolean {
  return kvMode === "blob";
}

/**
 * Which access mode this deployment's Vercel Blob store accepts.
 *
 * A Blob store is created as either public or private, and requesting the
 * wrong one makes the SDK throw — which is why photo uploads failed on a
 * private store even though the JSON document store (lib/kv.ts) persisted
 * normally, since that one writes privately. We try public first (CDN-served,
 * fastest) and remember the answer for the life of the instance, so the probe
 * costs at most one rejected call. Private bytes cannot be fetched from a
 * browser, so those URLs point at /api/uploads/[id] instead of the CDN.
 */
let blobAccess: "public" | "private" | null = null;

/**
 * The Blob operations this store needs, behind a seam so the access-mode
 * fallback can be tested without a real store (mirrors lib/kv.ts).
 */
interface BlobClient {
  put(
    path: string,
    body: Buffer,
    opts: { access: "public" | "private"; addRandomSuffix: boolean; allowOverwrite: boolean; contentType: string },
  ): Promise<{ url: string }>;
  get(
    path: string,
    opts: { access: "public" | "private"; useCache: boolean },
  ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  del(path: string): Promise<void>;
}

let blobClient: BlobClient | null = null;

/** Test hook: swap in a fake blob store (also clears the remembered access mode). */
export function __setBlobClientForTests(c: BlobClient | null): void {
  blobClient = c;
  blobAccess = null;
}

async function blob(): Promise<BlobClient> {
  if (blobClient) return blobClient;
  const mod = await import("@vercel/blob");
  blobClient = {
    put: (path, body, opts) => mod.put(path, body, opts),
    get: (path, opts) => mod.get(path, opts),
    del: (path) => mod.del(path),
  };
  return blobClient;
}

async function putBlobObject(
  pathname: string,
  buf: Buffer,
  type: string,
): Promise<{ path: string; access: "public" | "private"; url: string | null }> {
  const put = (await blob()).put;
  const opts = { addRandomSuffix: false, allowOverwrite: true, contentType: type } as const;

  if (blobAccess !== "private") {
    try {
      const res = await put(pathname, buf, { ...opts, access: "public" });
      blobAccess = "public";
      return { path: pathname, access: "public", url: res.url };
    } catch (err) {
      // A public request against a private store fails here. Once we know the
      // store is private we skip straight to private on later uploads.
      console.warn(
        "[avatar-store] public blob access unavailable, trying private:",
        err instanceof Error ? err.message : err,
      );
      if (blobAccess === "public") throw err;
    }
  }

  await put(pathname, buf, { ...opts, access: "private" });
  blobAccess = "private";
  // Private objects are not readable from the browser — served via our route.
  return { path: pathname, access: "private", url: null };
}

/** Read a stored blob back as bytes — used to serve private images. */
export async function readBlobObject(
  path: string,
  access: "public" | "private",
): Promise<Buffer | null> {
  const res = await (await blob()).get(path, { access, useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}

/** Remember a blob-backed image so the serving route and delete can find it. */
async function rememberBlob(
  id: string,
  up: { path: string; access: "public" | "private" },
  type: string,
): Promise<void> {
  await mutate((d) => ({
    doc: {
      ...d,
      avatars: {
        ...d.avatars,
        [id]: {
          type,
          uploaded_at: new Date().toISOString(),
          blob_path: up.path,
          blob_access: up.access,
        },
      },
    },
    result: undefined,
  }));
}

/**
 * Store an avatar image. Returns the public URL to save on the user record.
 * In blob mode that is a permanent CDN URL; in file mode it is our own
 * serving route, stable across restarts because the id is content-derived.
 */
export async function putAvatar(
  userId: string,
  data: string, // data URL "data:image/...;base64,..."
  type: string,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return { error: "Unsupported image type. Use JPG, PNG or WebP." };
  }
  const base64 = data.includes(",") ? data.split(",")[1] ?? "" : data;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_AVATAR_BYTES) {
    return { error: "Image is too large. Please choose one under 1.5 MB." };
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64.slice(0, 100))) {
    return { error: "The image could not be read." };
  }

  // Deterministic id: replacing a photo with the same bytes reuses the same
  // record; different bytes always create a new one.
  const id = `av_${userId.slice(0, 8)}_${(await sha1Short(`${type}:${base64.slice(-4096)}:${base64.length}`))}`;

  if (isBlobMode()) {
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    try {
      const up = await putBlobObject(`hillsense/avatars/${id}.${ext}`, Buffer.from(base64, "base64"), type);
      // Private blobs are only reachable through our own route, so the pathname
      // is recorded for serving and deletion.
      if (up.access === "private") await rememberBlob(id, up, type);
      return { url: up.url ?? `/api/uploads/${id}` };
    } catch (err) {
      console.error("[avatar-store] blob put failed", err);
      return { error: "Could not store the photo. Please try again." };
    }
  }

  // File mode: keep the data URL in the document store and serve via route.
  await mutate((d) => ({
    doc: { ...d, avatars: { ...d.avatars, [id]: { data: `data:${type};base64,${base64}`, type, uploaded_at: new Date().toISOString() } } },
    result: undefined,
  }));
  return { url: `/api/uploads/${id}` };
}

/**
 * Non-sensitive photo-storage status, for /api/storage-status. `access` only
 * applies to a Blob store and stays absent until an upload has established
 * which mode the store accepts (/api/storage-status?probe=photo resolves it).
 */
export function photoStorageInfo(): { mode: "blob" | "file"; access?: "public" | "private" } {
  if (!isBlobMode()) return { mode: "file" }; // bytes live in the document store
  return { mode: "blob", ...(blobAccess ? { access: blobAccess } : {}) };
}

/** A 1x1 PNG — enough to prove an image write works, too small to matter. */
const PROBE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Diagnostic probe: store one 1x1 PNG through the real report-photo path so a
 * deployment can verify photo storage end to end. The id is content-derived, so
 * repeated probes overwrite the same object — nothing accumulates, and no user
 * data is touched.
 */
export async function probePhotoStorage(): Promise<
  { ok: true; url: string; access?: "public" | "private" } | { ok: false; error: string }
> {
  const res = await putReportPhoto("diagnostic", `data:image/png;base64,${PROBE_PNG}`, "image/png");
  if ("error" in res) return { ok: false, error: res.error };
  return { ok: true, url: res.url, ...(blobAccess ? { access: blobAccess } : {}) };
}

export type StoredImage =
  | { kind: "data"; data: string; type: string }
  | { kind: "blob"; path: string; access: "public" | "private"; type: string };

/**
 * Resolve an upload id for the serving route.
 *  - file mode  → the data URL held in the JSON document store
 *  - blob mode  → the object pathname, read back through the SDK (a private
 *    blob cannot be fetched by the browser directly)
 */
export async function getStoredImage(id: string): Promise<StoredImage | null> {
  // Only our own id shapes are served; no slashes or dots, so a crafted id can
  // never escape the store prefix it is used to build.
  if (!/^(av|rp)_[A-Za-z0-9_-]+$/.test(id)) return null;
  const d =
    kvMode === "file"
      ? (cache ?? (await fallback()))
      : await kvLoadDoc<UploadsDb>(KV_KEY, async () => ({ ...EMPTY }));
  const hit = d.avatars[id];
  if (!hit) return null;
  if (hit.blob_path) {
    return { kind: "blob", path: hit.blob_path, access: hit.blob_access ?? "private", type: hit.type };
  }
  if (hit.data) return { kind: "data", data: hit.data, type: hit.type };
  return null;
}

const MAX_REPORT_PHOTO_BYTES = 6_000_000;

/**
 * Store an offline report's photo evidence. Reuses the exact same storage as
 * avatars (blob mode → CDN URL, file mode → serving route) but with a larger
 * size budget and report-photo ids so the two never collide.
 */
export async function putReportPhoto(
  userId: string,
  data: string, // data URL
  type: string,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return { error: "Unsupported image type in the saved report photo." };
  }
  const base64 = data.includes(",") ? data.split(",")[1] ?? "" : data;
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_REPORT_PHOTO_BYTES) {
    return { error: "The saved report photo is too large to upload." };
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(base64.slice(0, 100))) {
    return { error: "The saved report photo could not be read." };
  }
  const id = `rp_${userId.slice(0, 8)}_${await sha1Short(`${type}:${base64.slice(-4096)}:${base64.length}`)}`;

  if (isBlobMode()) {
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    try {
      const up = await putBlobObject(`hillsense/reports/${id}.${ext}`, Buffer.from(base64, "base64"), type);
      if (up.access === "private") await rememberBlob(id, up, type);
      return { url: up.url ?? `/api/uploads/${id}` };
    } catch (err) {
      console.error("[avatar-store] report photo blob put failed", err);
      return { error: "Photo storage is unavailable right now." };
    }
  }

  await mutate((d) => ({
    doc: { ...d, avatars: { ...d.avatars, [id]: { data: `data:${type};base64,${base64}`, type, uploaded_at: new Date().toISOString() } } },
    result: undefined,
  }));
  return { url: `/api/uploads/${id}` };
}

/** Best-effort removal of a user's previous avatar bytes (blob + file mode). */
export async function deleteAvatarByUrl(url: string): Promise<void> {
  try {
    if (url.startsWith("/api/uploads/")) {
      const id = url.split("/").pop() ?? "";
      const removed = await mutate((d) => {
        const hit = d.avatars[id];
        if (!hit) return { doc: d, result: null };
        const avatars = { ...d.avatars };
        delete avatars[id];
        return { doc: { ...d, avatars }, result: hit };
      });
      // Private blob-backed images also need their object removed from the store.
      if (removed?.blob_path) {
        await (await blob()).del(removed.blob_path);
      }
      return;
    }
    if (url.includes("blob.vercel-storage.com") || url.includes("/hillsense/avatars/")) {
      await (await blob()).del(url);
    }
  } catch (err) {
    console.warn("[avatar-store] delete previous avatar failed (continuing)", err);
  }
}

async function sha1Short(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}
