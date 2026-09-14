import { NextRequest, NextResponse } from "next/server";
import { normalizePhone, verifyOtp, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { phone?: string; code?: string };
    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json({ error: "Invalid phone number." }, { status: 400 });
    }
    const result = await verifyOtp(phone, body.code ?? "");
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      token: result.token,
      user: publicUser(result.user),
      is_new: result.isNew,
    });
  } catch (err) {
    console.error("[auth/otp/verify]", err);
    return NextResponse.json({ error: "Could not verify the code." }, { status: 500 });
  }
}
