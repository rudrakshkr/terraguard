"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  User as UserIcon, MapPin, Camera, Trash2, Check, Loader2, ShieldCheck,
  Phone, AlertTriangle, ArrowLeft, CalendarDays,
} from "lucide-react";
import { useAuth, authFetch, type AuthUser } from "@/hooks/useAuth";
import { Spinner } from "@/components/Spinner";
import { toast } from "@/components/Toaster";

interface FullProfile {
  id: string;
  display_name: string;
  initials: string;
  phone_masked: string;
  verified_phone: boolean;
  email: string;
  avatar_url: string | null;
  location: {
    full_address?: string;
    locality?: string;
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
    approximate?: boolean;
  } | null;
  created_at: string;
  onboarded: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Downscale the chosen image in the browser so uploads stay small. */
async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 400_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, authed, loading: authLoading, updateProfile } = useAuth();
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !authed) router.replace("/login?next=/profile");
  }, [authLoading, authed, router]);

  useEffect(() => {
    if (!authed) return;
    const t = setTimeout(() => {
      authFetch("/api/auth/me?full=1", { cache: "no-store" })
        .then(async (r) => {
          const data = (await r.json()) as { profile?: FullProfile; error?: string };
          if (!r.ok || !data.profile) throw new Error(data.error ?? "Could not load your profile.");
          setProfile(data.profile);
          setName(data.profile.display_name === "HillSense user" ? "" : data.profile.display_name);
          setEmail(data.profile.email ?? "");
          setLoadError(null);
        })
        .catch(async (e: unknown) => {
          // Offline profile fallback: the cached auth user remains available
          // even when /api/auth/me cannot be reached. Location is kept locally
          // because it is also needed for offline-first nearby/report flows.
          try {
            let location: FullProfile["location"] = null;
            const raw = localStorage.getItem("hillsense-location");
            if (raw) {
              const l = JSON.parse(raw) as {
                label?: string; lat?: number; lng?: number; approximate?: boolean;
                address?: { locality?: string; city?: string; district?: string; state?: string; pincode?: string; full_address?: string };
              };
              if (l && typeof l.label === "string") {
                location = {
                  full_address: l.address?.full_address ?? l.label,
                  locality: l.address?.locality,
                  city: l.address?.city,
                  district: l.address?.district,
                  state: l.address?.state,
                  pincode: l.address?.pincode,
                  lat: typeof l.lat === "number" ? l.lat : undefined,
                  lng: typeof l.lng === "number" ? l.lng : undefined,
                  approximate: l.approximate === true,
                };
              }
            }
            if (user) {
              const fallbackProfile: FullProfile = {
                id: user.id,
                display_name: user.display_name || "HillSense user",
                initials: user.initials || "H",
                phone_masked: "••••••••••",
                verified_phone: true,
                email: "",
                avatar_url: user.avatar_url ?? null,
                location,
                created_at: "",
                onboarded: user.onboarded,
              };
              setProfile(fallbackProfile);
              setName(fallbackProfile.display_name === "HillSense user" ? "" : fallbackProfile.display_name);
              setEmail("");
              setLoadError(null);
              setNotice("Showing your saved profile while offline.");
              return;
            }
          } catch {
            /* fall through to the normal error state */
          }
          setLoadError(e instanceof Error ? e.message : "Could not load your profile.");
        })
        .finally(() => setLoadingProfile(false));
    }, 0);
    return () => clearTimeout(t);
  }, [authed, user]);

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      display_name: name.trim() || profile.display_name,
      email: email.trim(),
    };
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const { enqueue, newOutboxId } = await import("@/lib/offline-db");
        await enqueue({
          id: newOutboxId(),
          kind: "profile",
          payload,
          created_at: new Date().toISOString(),
          state: "pending",
          attempts: 0,
        });
        const localUser = user ? { ...user, display_name: payload.display_name } : null;
        if (localUser) updateProfile(localUser);
        setProfile((p) => (p ? { ...p, display_name: payload.display_name, email: payload.email } : p));
        setNotice("Saved offline — your profile changes will sync when you're back online.");
        return;
      }

      const res = await authFetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { user?: AuthUser; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error ?? "Could not save your profile.");
      if (data.user) updateProfile(data.user);
      setProfile((p) => (p ? { ...p, display_name: data.user!.display_name, email: payload.email } : p));
      setNotice("Profile saved.");
      toast("Profile saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function onPickPhoto(f: File | null) {
    if (!f) return;
    setError(null);
    setNotice(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (f.size > 8_000_000) {
      setError("That image is too large. Please choose one under 8 MB.");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("Profile photo changes need an internet connection. Your name and email can still be saved offline.");
      return;
    }
    setUploading(true);
    try {
      const prepared = await prepareImage(f);
      const form = new FormData();
      form.append("file", prepared);
      const res = await authFetch("/api/uploads/avatar", { method: "POST", body: form });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not upload the photo.");
      // Persist the reference on the profile.
      const saveRes = await authFetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() || profile?.display_name, email: email.trim(), avatar_url: data.url }),
      });
      const saveData = (await saveRes.json()) as { user?: AuthUser; error?: string };
      if (!saveRes.ok || !saveData.user) throw new Error(saveData.error ?? "Could not save the photo.");
      if (saveData.user) updateProfile(saveData.user);
      setProfile((p) => (p ? { ...p, avatar_url: data.url! } : p));
      setNotice("Photo updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removePhoto() {
    if (!profile?.avatar_url) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const res = await authFetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() || profile.display_name, email: email.trim(), avatar_url: null }),
      });
      const data = (await res.json()) as { user?: AuthUser; error?: string };
      if (!res.ok || !data.user) throw new Error(data.error ?? "Could not remove the photo.");
      if (data.user) updateProfile(data.user);
      setProfile((p) => (p ? { ...p, avatar_url: null } : p));
      setNotice("Photo removed.");
      toast("Profile photo removed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setUploading(false);
    }
  }

  if (authLoading) {
    return (
      <div className="container-page py-16">
        <div className="flex items-center justify-center gap-3 muted"><Spinner className="h-5 w-5" /> Checking your session…</div>
      </div>
    );
  }
  if (!authed) return null;

  const avatar = profile?.avatar_url ?? user?.avatar_url ?? null;
  const initials = profile?.initials ?? user?.initials ?? "H";
  const memberSince = profile?.created_at
    ? `${new Date(profile.created_at).getDate()} ${MONTHS[new Date(profile.created_at).getMonth()]} ${new Date(profile.created_at).getFullYear()}`
    : null;
  const loc = profile?.location;

  return (
    <div className="container-page mx-auto max-w-2xl py-6 sm:py-8">
      <Link href="/home" className="tap-link max-md:-ml-2 mb-4 gap-1.5 text-[13px] font-medium muted hover:opacity-80 max-md:px-2">
        <ArrowLeft className="h-4 w-4" /> Back to my feed
      </Link>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--accent-soft)" }}>
          <UserIcon className="h-5 w-5" style={{ color: "var(--accent)" }} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Your profile</h1>
          <p className="text-[12.5px] muted">Saved to your HillSense account — visible only to you. Profile changes can be queued while offline.</p>
        </div>
      </div>

      {loadingProfile ? (
        <div className="card flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : loadError ? (
        <div className="card p-6 text-center">
          <AlertTriangle className="mx-auto h-6 w-6" style={{ color: "var(--warn)" }} />
          <p className="mt-2 text-[13.5px]" style={{ color: "var(--danger)" }}>{loadError}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={() => window.location.reload()}>Try again</button>
        </div>
      ) : (
        <div className="card space-y-6 p-6">
          {/* Photo */}
          <section>
            <h2 className="text-[14px] font-semibold">Profile photo</h2>
            <div className="mt-3 flex items-center gap-4">
              <div className="relative">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="Your profile photo" className="h-16 w-16 rounded-full object-cover" style={{ border: "1px solid var(--border)" }} />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-full text-lg font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    {initials}
                  </span>
                )}
                {uploading && (
                  <span className="absolute inset-0 flex items-center justify-center rounded-full" style={{ background: "rgba(0,0,0,0.35)" }}>
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <Camera className="h-4 w-4" /> {avatar ? "Change photo" : "Upload photo"}
                </button>
                {avatar && (
                  <button type="button" className="btn btn-ghost" disabled={uploading} onClick={removePhoto}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </button>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)} />
              </div>
            </div>
            <p className="mt-2 text-[11.5px] faint">JPG, PNG or WebP. Square images look best. Your photo shows next to your community updates.</p>
          </section>

          {/* Details */}
          <section className="space-y-3 border-t pt-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold">
              <UserIcon className="h-4 w-4" style={{ color: "var(--accent)" }} /> Personal details
            </h2>
            <div>
              <label htmlFor="pf-name" className="text-[12.5px] font-semibold muted">Full name</label>
              <input id="pf-name" className="input mt-1" placeholder="e.g. Anil Sharma" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </div>
            <div>
              <label htmlFor="pf-email" className="text-[12.5px] font-semibold muted">Email <span className="faint font-normal">(optional)</span></label>
              <input id="pf-email" type="email" className="input mt-1" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={120} />
            </div>
            <div>
              <label className="text-[12.5px] font-semibold muted">Phone (verified)</label>
              <div className="input mt-1 flex items-center gap-2" style={{ background: "var(--surface-2)" }}>
                <Phone className="h-3.5 w-3.5 muted" />
                <span className="text-[13.5px]">{profile?.phone_masked}</span>
                <span className="chip chip-low ml-auto"><Check className="h-3 w-3" /> Verified</span>
              </div>
              <p className="mt-1 text-[11px] faint">Your number is never shown to other users or attached to reports.</p>
            </div>
            {memberSince && (
              <div>
                <label className="text-[12.5px] font-semibold muted">Member since</label>
                <div className="mt-1 flex items-center gap-2 text-[13.5px]"><CalendarDays className="h-4 w-4 muted" /> {memberSince}</div>
              </div>
            )}
          </section>

          {/* Location */}
          <section className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
            <h2 className="flex items-center gap-2 text-[14px] font-semibold">
              <MapPin className="h-4 w-4" style={{ color: "var(--accent)" }} /> Saved location
            </h2>
            {loc?.full_address || loc?.city || loc?.district ? (
              <>
                <p className="mt-2 text-[13.5px]">{loc?.full_address || [loc?.city, loc?.district, loc?.state].filter(Boolean).join(", ")}</p>
                {loc?.approximate && <p className="mt-1 text-[11.5px] faint">Approximate — set a precise location from onboarding for better nearby alerts.</p>}
              </>
            ) : (
              <p className="mt-2 text-[13px] muted">No location saved yet — nearby alerts cover the whole region.</p>
            )}
            <Link href="/onboarding" className="btn btn-secondary mt-3">Update location</Link>
            <p className="mt-2 flex items-start gap-1.5 text-[11.5px] faint">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
              Your exact home address stays private — it is never attached to reports or comments you publish.
            </p>
          </section>

          {error && (
            <p className="rounded-lg p-3 text-[12.5px]" style={{ background: "var(--danger-soft)", color: "var(--danger)" }} role="alert">{error}</p>
          )}
          {notice && (
            <p className="flex items-center gap-1.5 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--low-soft)", color: "var(--low)" }} role="status">
              <Check className="h-4 w-4" /> {notice}
            </p>
          )}

          <button type="button" onClick={save} disabled={saving} className="btn btn-primary w-full justify-center">
            {saving ? <Spinner className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </div>
  );
}