"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  User as UserIcon, MapPin, LocateFixed, Check, ChevronDown, ShieldCheck, Phone, Info,
} from "lucide-react";
import { useAuth, authFetch } from "@/hooks/useAuth";
import {
  useLocationPreference,
  PRESETS,
  type ResolvedAddress,
} from "@/hooks/useLocationPreference";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toaster";

/**
 * Post-login onboarding: profile details + location, then hand off to the
 * personalized recent-hazards page (/home). The exact home address stays on
 * the user's profile — it is never published with reports or comments.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const { user, authed, loading, updateProfile } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    loc, busy: locBusy, resolvingAddress, error: locError,
    useMyLocation, pickPreset, setCustom, setAddress,
  } = useLocationPreference();

  useEffect(() => {
    if (!loading && !authed) router.replace("/login?next=/onboarding");
  }, [loading, authed, router]);

  // Returning user with an already-completed profile goes straight to the app.
  useEffect(() => {
    if (!loading && authed && user?.onboarded) {
      router.replace("/home");
    }
  }, [loading, authed, user?.onboarded, router]);

  // Prefill name from existing profile when the field is untouched.
  const [manualMode, setManualMode] = useState<"auto" | "manual">("auto");
  // Derived prefill: show existing profile name while the field stays editable.
  const nameValue = name || user?.display_name || "";

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: nameValue,
          email: email.trim() || undefined,
          location: loc
            ? {
                full_address: loc.label,
                locality: loc.address?.locality,
                city: loc.address?.city,
                district: loc.address?.district,
                state: loc.address?.state,
                pincode: loc.address?.pincode,
                ...(Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
                  ? { lat: loc.lat, lng: loc.lng }
                  : {}),
                approximate: loc.approximate,
              }
            : undefined,
        }),
      });
      const data = (await res.json()) as { user?: typeof user; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error ?? "Could not save your profile.");
      updateProfile(data.user);
      toast("Profile setup complete");
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container-page py-16">
        <div className="flex items-center justify-center gap-3 muted"><Spinner className="h-5 w-5" /> Checking your session…</div>
      </div>
    );
  }

  if (!authed) return null; // redirecting



  return (
    <div className="container-page mx-auto max-w-xl py-8 sm:py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-soft)" }}>
          <ShieldCheck className="h-5 w-5" style={{ color: "var(--accent)" }} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Set up your profile</h1>
          <p className="text-[12.5px] muted">Step 2 of 2 — one minute, and you&apos;re in.</p>
        </div>
      </div>

      <div className="card space-y-5 p-6">
        {/* personal details */}
        <section>
          <h2 className="flex items-center gap-2 text-[14px] font-semibold">
            <UserIcon className="h-4 w-4" style={{ color: "var(--accent)" }} /> Personal details
          </h2>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="onb-name" className="text-[12.5px] font-semibold muted">Full name</label>
              <input
                id="onb-name"
                className="input mt-1"
                placeholder="e.g. Anil Sharma"
                value={nameValue}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </div>
            <div>
              <label className="text-[12.5px] font-semibold muted">Phone (verified)</label>
              <div className="input mt-1 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
                <Phone className="h-3.5 w-3.5 muted" />
                <span className="text-[13.5px]">Verified via OTP — not shown publicly</span>
                <Check className="ml-auto h-4 w-4" style={{ color: "var(--low)" }} />
              </div>
            </div>
            <div>
              <label htmlFor="onb-email" className="text-[12.5px] font-semibold muted">Email <span className="faint font-normal">(optional)</span></label>
              <input
                id="onb-email"
                type="email"
                className="input mt-1"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* location */}
        <section className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold">
              <MapPin className="h-4 w-4" style={{ color: "var(--accent)" }} /> Your location
            </h2>
            <div className="flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }} role="group">
              {(["auto", "manual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={manualMode === m}
                  onClick={() => setManualMode(m)}
                  className="rounded-md px-2.5 py-1 text-[12px] font-semibold capitalize max-md:min-h-11 max-md:px-3"
                  style={{
                    background: manualMode === m ? "var(--accent-soft)" : "transparent",
                    color: manualMode === m ? "var(--accent)" : "var(--text-2)",
                  }}
                >
                  {m === "auto" ? "Use current location" : "Enter manually"}
                </button>
              ))}
            </div>
          </div>

          {manualMode === "auto" ? (
            <div className="mt-3">
              <button type="button" onClick={useMyLocation} disabled={locBusy} className="btn btn-secondary">
                {locBusy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />}
                Use my current location
              </button>
              {resolvingAddress && (
                <p className="mt-2 flex items-center gap-1.5 text-[12px] muted">
                  <Spinner className="h-3 w-3" /> Resolving your address…
                </p>
              )}
              {loc && (
                <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <p className="text-[13px] leading-relaxed">{loc.label}</p>
                  {loc.address && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] muted">
                      {loc.address.locality && <span>{loc.address.locality}</span>}
                      {loc.address.district && <span>· {loc.address.district}</span>}
                      {loc.address.state && <span>· {loc.address.state}</span>}
                      {loc.address.pincode && <span>· {loc.address.pincode}</span>}
                    </div>
                  )}
                  <p className="mt-1 text-[11px] faint">
                    {loc.approximate
                      ? "Approximate location — edit the address below if it is not accurate."
                      : "Location detected from your device. Please verify before submitting."}
                  </p>
                </div>
              )}
              {locError && <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>{locError}</p>}
              {loc && (
                <label className="mt-2 block text-[11.5px] faint" htmlFor="onb-addr-edit">
                  Something wrong? Edit the address:
                </label>
              )}
              {loc && (
                <textarea
                  id="onb-addr-edit"
                  className="input mt-1 min-h-[48px] resize-y text-[13px]"
                  value={loc.label}
                  onChange={(e) =>
                    setAddress({
                      ...(loc.address ?? {
                        full_address: e.target.value,
                        lat: loc.lat,
                        lng: loc.lng,
                        approximate: true,
                      }),
                      full_address: e.target.value,
                    } as ResolvedAddress)
                  }
                />
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <input
                className="input"
                placeholder="Village, town, landmark or full address"
                onBlur={(e) => e.target.value.trim() && setCustom(e.target.value)}
                onKeyDown={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (e.key === "Enter" && v) setCustom(v);
                }}
              />
              <div>
                <label className="text-[12.5px] font-semibold muted">Or pick a nearby town</label>
                <div className="relative mt-1">
                  <select
                    className="input pr-8"
                    value={loc?.preset ?? ""}
                    onChange={(e) => e.target.value && pickPreset(e.target.value)}
                    aria-label="Choose a nearby town"
                  >
                    <option value="">choose a town…</option>
                    {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 faint" />
                </div>
              </div>
              {loc && (
                <p className="text-[12px] muted">
                  Selected: <strong>{loc.label}</strong>
                  {loc.approximate && " (approximate — map position estimated)"}
                </p>
              )}
            </div>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px] faint">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Your exact home address stays private — it is saved to your profile only and is never
            attached to reports or comments you publish.
          </p>
        </section>

        {error && (
          <p className="rounded-lg p-3 text-[12.5px]" style={{ background: "var(--danger-soft)", color: "var(--danger)" }} role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={save}
          disabled={saving || !nameValue.trim() || (manualMode === "auto" && !loc)}
          className="btn btn-primary w-full justify-center"
        >
          {saving ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {saving ? "Saving…" : "Save & see hazards near me"}
        </button>
        {manualMode === "manual" && !loc && (
          <p className="text-center text-[11.5px] faint">
            You can skip location for now — you&apos;ll see hazards for all of Himachal Pradesh.
          </p>
        )}
      </div>

      <p className="mt-4 text-center text-[11.5px] faint">
        <Link href="/" className="tap-link justify-center underline">Skip for now — just show me the public map</Link>
      </p>
    </div>
  );
}
