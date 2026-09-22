import { NextRequest, NextResponse } from "next/server";
import {
  kvMode,
  kvEnabled,
  storagePersistent,
  storageRuntime,
  storageConfig,
  persistenceProblem,
  kvGetJson,
  kvLoadDoc,
  kvSaveDoc,
} from "@/lib/kv";
import { photoStorageInfo, probePhotoStorage } from "@/lib/avatar-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal storage diagnostic — NON-SENSITIVE by construction.
 *
 * Reports which storage backend is active and whether it can actually persist
 * data. Used to verify Vercel deployments (persistent MUST be true there).
 *
 * NEVER exposed here: Redis/blob tokens, session tokens, SMS provider keys,
 * user records or phone numbers — only boolean config flags and a live
 * connectivity probe result. No probe ever writes user data.
 *
 * Add ?probe=photo to also verify PHOTO storage (the path that failed on a
 * private Vercel Blob store while the JSON documents persisted fine).
 */
export async function GET(req: NextRequest) {
  const photoProbeRequested = req.nextUrl.searchParams.get("probe") === "photo";
  let probe: "ok" | "failed" | "skipped" = "skipped";
  if (kvMode === "upstash") {
    // Read-only GET against Redis — verifies credentials and connectivity
    // without creating or modifying any key.
    try {
      await kvGetJson("__hillsense_probe__");
      probe = "ok";
    } catch {
      probe = "failed";
    }
  } else if (kvMode === "blob") {
    // Round-trip a tiny document through the kv layer: same store, same access
    // mode and same credentials the real writes use, so the result reflects
    // actual persistence rather than a separate code path.
    const key = "hillsense:__probe__:v1";
    try {
      await kvSaveDoc(key, { probe: Date.now() });
      const back = await kvLoadDoc<{ probe?: number }>(key, async () => ({}));
      probe = typeof back?.probe === "number" ? "ok" : "failed";
    } catch {
      probe = "failed";
    }
  }

  return NextResponse.json(
    {
      // "upstash" | "blob" | "file"
      storage_mode: kvMode,
      // File mode is persistent ONLY in local development. On Vercel it means
      // every write is silently lost between requests.
      persistent: storagePersistent,
      shared_backend: kvEnabled,
      runtime: storageRuntime,
      backends_configured: storageConfig,
      connectivity_probe: probe,
      // Profile/report photos are stored separately from the JSON documents, so
      // they can fail on their own (e.g. a store that rejects public access).
      photo_storage: {
        ...photoStorageInfo(),
        ...(photoProbeRequested ? { probe: await probePhotoStorage() } : {}),
      },
      ...(persistenceProblem ? { configuration_error: persistenceProblem } : {}),
    },
    // Signal misconfiguration at the HTTP level too, so a health check can
    // simply look for a 5xx on Vercel.
    { status: persistenceProblem ? 503 : 200 },
  );
}
