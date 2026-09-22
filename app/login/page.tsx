"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Phone, ShieldCheck, ArrowLeft, Info } from "lucide-react";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toaster";

type Step = "phone" | "otp" | "onboarding";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="container-page py-16">
          <div className="flex items-center justify-center gap-3 muted"><Spinner className="h-5 w-5" /> Loading…</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/onboarding";
  const { user, signIn } = useAuth();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resentCooldown, setResentCooldown] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "otp") otpRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (resentCooldown <= 0) return;
    const t = setInterval(() => setResentCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resentCooldown]);

  // Already signed in → skip straight to onboarding/target.
  useEffect(() => {
    if (user) {
      router.replace(user.onboarded ? next : "/onboarding");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function sendOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = (await res.json()) as { sent?: boolean; dev_mode?: boolean; dev_code?: string; error?: string };
      if (!res.ok || !data.sent) throw new Error(data.error ?? "Could not send the code.");
      setDevMode(data.dev_mode === true);
      setDevCode(data.dev_code ?? null);
      setStep("otp");
      setResentCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = (await res.json()) as {
        authenticated?: boolean;
        token?: string;
        user?: AuthUser;
        is_new?: boolean;
        error?: string;
      };
      if (!res.ok || !data.token || !data.user) throw new Error(data.error ?? "Verification failed.");
      signIn(data.user, data.token);
      toast("Signed in successfully");
      // The server's user record decides this: an existing completed profile
      // never sees onboarding again.
      router.replace(data.user.onboarded ? next : "/onboarding");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-page mx-auto max-w-md py-10 sm:py-12">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-soft)" }}>
            <ShieldCheck className="h-5 w-5" style={{ color: "var(--accent)" }} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {step === "phone" ? "Sign in to HillSense" : "Enter the code"}
            </h1>
            <p className="text-[12.5px] muted">
              {step === "phone"
                ? "One account for reporting, confirming and commenting."
                : `Sent to +${phone.replace(/^91(\d{5})\d{3}(\d{2})$/, "91 $1•••$2")}`}
            </p>
          </div>
        </div>

        {step === "phone" ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <div>
              <label htmlFor="phone" className="text-[13px] font-semibold">Mobile number</label>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-lg border px-3 py-2.5 text-[14px] muted" style={{ borderColor: "var(--border)" }}>+91</span>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  className="input flex-1"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                  maxLength={13}
                  required
                />
              </div>
              <p className="mt-1.5 text-[11.5px] faint">
                We&apos;ll text you a 6-digit verification code. Your number is never shown publicly.
              </p>
            </div>
            {error && <p className="text-[12.5px]" style={{ color: "var(--danger)" }} role="alert">{error}</p>}
            <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className="btn btn-primary w-full justify-center">
              {busy ? <Spinner className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
              Send OTP
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            {devMode && (
              <div className="flex items-start gap-2 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Development mode:</strong> no SMS provider is configured, so the code is
                  shown here instead of being texted.{" "}
                  {devCode && (
                    <>
                      Your code is <strong className="mono text-[14px]">{devCode}</strong>.
                    </>
                  )}
                </span>
              </div>
            )}
            <div>
              <label htmlFor="otp" className="text-[13px] font-semibold">6-digit code</label>
              <input
                id="otp"
                ref={otpRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="••••••"
                className="input mt-1.5 text-center !text-[22px] tracking-[0.5em] mono"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                required
              />
            </div>
            {error && <p className="text-[12.5px]" style={{ color: "var(--danger)" }} role="alert">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6} className="btn btn-primary w-full justify-center">
              {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              Verify & continue
            </button>
            <div className="flex items-center justify-between text-[12.5px]">
              <button
                type="button"
                className="flex items-center gap-1 font-medium"
                style={{ color: "var(--accent)" }}
                onClick={() => { setStep("phone"); setCode(""); setError(null); }}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Change number
              </button>
              <button
                type="button"
                className="font-medium disabled:opacity-50"
                style={{ color: "var(--accent)" }}
                disabled={busy || resentCooldown > 0}
                onClick={() => { void sendOtp(); }}
              >
                {resentCooldown > 0 ? `Resend in ${resentCooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-4 text-center text-[11.5px] faint">
        By continuing you agree to use HillSense responsibly.{" "}
        <Link href="/" className="underline">Browse hazards without an account</Link>
      </p>
    </div>
  );
}
