import { NextRequest, NextResponse } from "next/server";
import { normalizePhone, sendOtp, maskPhone } from "@/lib/auth";
import { persistenceConfigError } from "@/lib/kv";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // OTP challenges live in the persistent store — refuse clearly when the
  // deployment cannot persist them instead of silently dropping the sign-in.
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

  try {
    const body = (await req.json()) as { phone?: string };
    const phone = normalizePhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json(
        { error: "Enter a valid 10-digit mobile number (India) or full number with country code." },
        { status: 400 },
      );
    }

    const result = await sendOtp(phone);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 429 });
    }

    // dev_code is ONLY included when no SMS provider is configured (AUTH_DEV_MODE).
    return NextResponse.json({
      sent: true,
      dev_mode: result.devMode,
      ...(result.devMode && "devCode" in result ? { dev_code: result.devCode } : {}),
    });
  } catch (err) {
    console.error("[auth/otp/send]", err, maskPhone(""));
    return NextResponse.json({ error: "Could not send the code. Please try again." }, { status: 500 });
  }
}
