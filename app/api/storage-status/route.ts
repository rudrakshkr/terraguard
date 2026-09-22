import { NextResponse } from "next/server";
import {
  kvMode,
  kvEnabled,
  storagePersistent,
  storageRuntime,
  storageConfig,
  persistenceProblem,
  kvGetJson,
} from "@/lib/kv";

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
 */
export async function GET() {
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
    // HEAD against Vercel Blob — verifies the store binding and token without
    // reading or writing any user document.
    try {
      const { head } = await import("@vercel/blob");
      await head("hillsense/data/__probe__.json");
      probe = "ok";
    } catch {
      // A missing blob is fine — only auth/connection errors matter. The SDK
      // throws for real failures, so any throw here means the store is not
      // usable as configured.
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
      ...(persistenceProblem ? { configuration_error: persistenceProblem } : {}),
    },
    // Signal misconfiguration at the HTTP level too, so a health check can
    // simply look for a 5xx on Vercel.
    { status: persistenceProblem ? 503 : 200 },
  );
}
