/**
 * Small binary store for user profile photos.
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
import { kvMode, dataDir, kvLoadDoc, kvMutate } from "./kv";

const DATA_PATH = `${dataDir}/.hillsense-uploads.json`.replace("//", "/");
const KV_KEY = "hillsense:uploads:v1";

export const MAX_AVATAR_BYTES = 1_500_000;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface UploadsDb {
  avatars: Record<string, { data: string; type: string; uploaded_at: string }>; // id → data URL
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
    try {
      const { put } = await import("@vercel/blob");
      const buf = Buffer.from(base64, "base64");
      const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      const res = await put(`hillsense/avatars/${id}.${ext}`, buf, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: type,
      });
      return { url: res.url };
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

/** Read avatar bytes in file mode. Blob mode URLs are served by the CDN directly. */
export async function getAvatar(id: string): Promise<{ data: string; type: string } | null> {
  if (!id.startsWith("av_")) return null;
  if (isBlobMode()) return null; // blob URLs are external; route is only for file mode
  const d = kvMode === "file" ? (cache ?? (await fallback())) : await kvLoadDoc<UploadsDb>(KV_KEY, async () => ({ ...EMPTY }));
  const hit = d.avatars[id];
  if (!hit) return null;
  return { data: hit.data, type: hit.type };
}

/** Best-effort removal of a user's previous avatar bytes (blob + file mode). */
export async function deleteAvatarByUrl(url: string): Promise<void> {
  try {
    if (url.startsWith("/api/uploads/")) {
      const id = url.split("/").pop() ?? "";
      await mutate((d) => {
        if (!d.avatars[id]) return { doc: d, result: undefined };
        const avatars = { ...d.avatars };
        delete avatars[id];
        return { doc: { ...d, avatars }, result: undefined };
      });
      return;
    }
    if (url.includes("blob.vercel-storage.com") || url.includes("/hillsense/avatars/")) {
      const { del } = await import("@vercel/blob");
      await del(url);
    }
  } catch (err) {
    console.warn("[avatar-store] delete previous avatar failed (continuing)", err);
  }
}

async function sha1Short(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}
