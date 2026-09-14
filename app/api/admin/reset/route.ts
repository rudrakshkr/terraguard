import { NextRequest, NextResponse } from "next/server";
import { resetIncidents, listIncidents } from "@/lib/store";
import { resetCommunity } from "@/lib/community-store";
import { resetAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token-guarded admin reset — wipes incidents, community votes/comments and
 * auth users. Intended for starting a demo from a clean slate.
 *
 * Guards:
 *  - disabled entirely unless ADMIN_RESET_TOKEN is set
 *  - requires `Authorization: Bearer <ADMIN_RESET_TOKEN>` (or ?token=)
 *  - GET explains usage without doing anything
 *
 * With HS_SEED=0 (set in production) the app then stays empty: only real,
 * user-submitted incidents are shown. Locally, removing HS_SEED=0 re-seeds
 * the demonstration data on next boot.
 */
function authorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_RESET_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const query = req.nextUrl.searchParams.get("token") ?? "";
  return bearer === expected || query === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "Set ADMIN_RESET_TOKEN and pass it as a bearer token to reset." },
      { status: process.env.ADMIN_RESET_TOKEN ? 401 : 501 },
    );
  }
  return NextResponse.json({ ok: true, hint: "POST to this URL to perform the reset." });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "Set ADMIN_RESET_TOKEN and pass it as a bearer token to reset." },
      { status: process.env.ADMIN_RESET_TOKEN ? 401 : 501 },
    );
  }
  try {
    await resetIncidents();
    await resetCommunity();
    await resetAuth();
    const remaining = await listIncidents();
    return NextResponse.json({
      ok: true,
      message: "All incidents, community responses, users and sessions were wiped.",
      incidents_remaining: remaining.length,
      seeds_enabled: process.env.HS_SEED !== "0",
    });
  } catch (err) {
    console.error("[api/admin/reset]", err);
    return NextResponse.json({ error: "Reset failed." }, { status: 500 });
  }
}
