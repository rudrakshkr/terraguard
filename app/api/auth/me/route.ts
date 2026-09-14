import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

/** GET — resolve the caller's session (Bearer token). */
export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ authenticated: false }, { status: 401 });
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
