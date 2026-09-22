import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, publicUser } from "@/lib/auth";
import { persistenceConfigError } from "@/lib/kv";

export const runtime = "nodejs";

/**
 * GET — resolve the caller's session (Bearer token).
 *
 * When `?full=1` the response includes the caller's OWN profile fields
 * (email, phone, saved location, avatar, member-since). This is the only
 * endpoint that returns them, and only for the signed-in user themselves —
 * public surfaces (comments, incidents) keep using publicUser().
 */
export async function GET(req: NextRequest) {
  // Misconfigured deployment: say so explicitly instead of answering 401,
  // which would make every signed-in user appear logged out.
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });

  if (req.nextUrl.searchParams.get("full") === "1") {
    return NextResponse.json({
      authenticated: true,
      profile: {
        id: user.id,
        display_name: user.display_name || "HillSense user",
        initials: (user.display_name || "H")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]!.toUpperCase())
          .join(""),
        // Own phone, masked for display: the user knows their number; showing
        // it fully adds nothing and keeps screenshots safe.
        phone_masked: `${user.phone.slice(0, 2)}${"•".repeat(Math.max(0, user.phone.length - 5))}${user.phone.slice(-3)}`,
        verified_phone: true,
        email: user.email ?? "",
        avatar_url: user.avatar_url ?? null,
        location: user.location ?? null,
        created_at: user.created_at,
        onboarded: user.onboarded,
      },
    });
  }

  return NextResponse.json({ authenticated: true, user: publicUser(user) });
}

/** DELETE — logout. */
export async function DELETE(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) {
    const { revokeToken } = await import("@/lib/auth");
    await revokeToken(m[1].trim());
  }
  return NextResponse.json({ ok: true });
}
