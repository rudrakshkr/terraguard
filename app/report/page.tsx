"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mic, MicOff, ImagePlus, X, MapPin, LocateFixed, ChevronDown,
  ShieldCheck, AlertTriangle, Ban, Send, Languages, Lightbulb, Search,
} from "lucide-react";
import type { AnalyzeResponse, IncidentType } from "@/lib/types";
import type { VerificationResult } from "@/lib/verification";
import { LOCATIONS } from "@/lib/threat";
import { useLocationPreference } from "@/hooks/useLocationPreference";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useAuth, authFetch } from "@/hooks/useAuth";
import DecisionTrace from "@/components/DecisionTrace";
import EvidencePanel from "@/components/EvidencePanel";
import SourcesPanel from "@/components/SourcesPanel";
import { SeverityChip, ModeBadge, EvidenceChip } from "@/components/Badge";
import { Spinner } from "@/components/Spinner";

/** Downscale large photos in the browser so uploads stay fast. */
async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 1_500_000) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

/** Read a File as a data URL (used to stash offline report photos in IndexedDB). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the image."));
    r.readAsDataURL(file);
  });
}

const VERDICT_STYLE: Record<string, { chip: string; icon: typeof ShieldCheck; label: string }> = {
  verified: { chip: "chip-low", icon: ShieldCheck, label: "AI CHECK PASSED" },
  needs_review: { chip: "chip-warn", icon: AlertTriangle, label: "NEEDS REVIEW" },
  rejected: { chip: "chip-critical", icon: Ban, label: "REJECTED" },
};

const HAZARD_TYPES: { value: IncidentType | "Other"; label: string }[] = [
  { value: "Landslide", label: "Landslide" },
  { value: "Rockfall", label: "Rockfall" },
  { value: "Flash Flood", label: "Flash Flood" },
  { value: "Flood", label: "Flood" },
  { value: "Road Blockage", label: "Road Blockage" },
  { value: "Building Damage", label: "Building Damage" },
  { value: "Forest Fire", label: "Forest Fire" },
  { value: "Avalanche", label: "Avalanche" },
  { value: "Other", label: "Other" },
];

const WHEN_OPTIONS = [
  { value: "just_now", label: "Just now" },
  { value: "hour", label: "Within the last hour" },
  { value: "today", label: "Today" },
  { value: "earlier", label: "Earlier" },
  { value: "exact", label: "Exact date/time" },
];

const NOW_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

const AFFECTED_OPTIONS = ["Road", "Houses/buildings", "Vehicles", "People", "River/waterbody", "Infrastructure", "Other"];

const CASUALTY_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unknown", label: "Unknown" },
];

const OBSERVED_SEVERITY = [
  { value: "Low", label: "Low" },
  { value: "Moderate", label: "Moderate" },
  { value: "Serious", label: "Serious" },
  { value: "Critical", label: "Critical" },
  { value: "Not sure", label: "Not sure" },
];

export default function ReportPage() {
  const router = useRouter();
  const { user, authed, loading: authLoading } = useAuth();
  const [description, setDescription] = useState("");
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [customPlace, setCustomPlace] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveClientIdRef = useRef<string | null>(null);

  /* ------------------------ new structured form fields ------------------------ */
  const [hazardType, setHazardType] = useState<IncidentType | "">("");
  const [whenHappened, setWhenHappened] = useState("");
  const [whenExact, setWhenExact] = useState("");
  const [happeningNow, setHappeningNow] = useState("");
  const [affected, setAffected] = useState<string[]>([]);
  const [affectedOther, setAffectedOther] = useState("");
  const [casualties, setCasualties] = useState("");
  const [observedSeverity, setObservedSeverity] = useState("");
  const [observations, setObservations] = useState("");

  const {
    loc, busy: locBusy, resolvingAddress, error: locError,
    useMyLocation, pickPreset, setCustom, setAddress, reverseGeocode,
  } = useLocationPreference();
  const speech = useSpeechRecognition(lang);

  // Voice transcripts append straight into the (editable) description box.
  const lastLenRef = useRef(0);
  useEffect(() => {
    const full = speech.finalText;
    if (full && full.length > lastLenRef.current) {
      const delta = full.slice(lastLenRef.current);
      setDescription((d) => (d ? `${d} ${delta.trim()}` : delta.trim()));
    }
    lastLenRef.current = full.length;
  }, [speech.finalText]);

  useEffect(() => {
    if (!image) {
      const t = setTimeout(() => setPreview(null), 0);
      return () => clearTimeout(t);
    }
    let cancelled = false;
    const url = URL.createObjectURL(image);
    const t = setTimeout(() => { if (!cancelled) setPreview(url); }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
      URL.revokeObjectURL(url);
    };
  }, [image]);

  const canAnalyze = useMemo(
    () => !analyzing && (description.trim().length > 0 || image !== null),
    [analyzing, description, image],
  );

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  /**
   * Offline save — no pretend analysis, no fake verification. The complete
   * report payload (including the photo, base64-downscaled) is stored in the
   * outbox and uploaded verbatim once connectivity returns; the backend then
   * runs the normal AI evidence check and the incident appears with the
   * "Pending AI verification" label until that completes.
   */
  async function saveOffline() {
    if (!hazardType || (!description.trim() && !image)) {
      setError("Pick a hazard type and add a description or photo first.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { enqueue, newOutboxId } = await import("@/lib/offline-db");
      // Preserve the device's real GPS coordinates even without a network:
      // raw lat/lng are stored as-is and the human-readable address is kept
      // only if the user typed/verified one. Reverse geocoding happens after
      // sync — a missing network must never replace coordinates with a broad
      // state-level label.
      const payload = {
        client_id: newOutboxId(),
        description: description.trim(),
        hazard_type: hazardType,
        reporter_details: {
          when: whenHappened || undefined,
          when_exact: whenHappened === "exact" && whenExact ? whenExact : undefined,
          happening_now: happeningNow || undefined,
          affected: [...affected, ...(affectedOther.trim() ? [affectedOther.trim()] : [])],
          casualties: casualties || undefined,
          observed_severity: observedSeverity || undefined,
          observations: observations.trim() || undefined,
        },
        location_text: loc?.address?.full_address || loc?.label || customPlace.trim() || undefined,
        lat: loc && Number.isFinite(loc.lat) ? loc.lat : undefined,
        lng: loc && Number.isFinite(loc.lng) ? loc.lng : undefined,
        coords_approximate: loc ? loc.approximate : true,
        address_verified: Boolean(loc?.address),
        photo: image
          ? { name: image.name, type: image.type, data: await fileToDataUrl(await prepareImage(image)) }
          : null,
        saved_at: new Date().toISOString(),
      };
      await enqueue({
        id: payload.client_id,
        kind: "report",
        payload,
        created_at: payload.saved_at,
        state: "pending",
        attempts: 0,
      });
      setDescription("");
      setImage(null);
      setObservations("");
      setNotice("Report saved offline — waiting for connection. It will upload automatically and AI verification will run once delivered.");
    } catch {
      setError("Could not save the report on this device. Free up space or try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onPickImage(f: File | null) {
    if (!f) { setImage(null); return; }
    if (!f.type.startsWith("image/")) { setError("Please choose an image file (JPG, PNG or WebP)."); return; }
    setError(null);
    setImage(await prepareImage(f));
  }

  /** Build the structured context string the AI verification consumes. */
  const reportContext = useMemo(() => {
    const parts: string[] = [];
    if (hazardType) parts.push(`Hazard type: ${hazardType}`);
    if (whenHappened) {
      const when = WHEN_OPTIONS.find((w) => w.value === whenHappened)?.label ?? whenHappened;
      parts.push(`When: ${when}${whenHappened === "exact" && whenExact ? ` (${whenExact})` : ""}`);
    }
    if (happeningNow) {
      parts.push(`Happening right now: ${NOW_OPTIONS.find((n) => n.value === happeningNow)?.label ?? happeningNow}`);
    }
    const aff = [...affected, ...(affectedOther.trim() ? [affectedOther.trim()] : [])];
    if (aff.length) parts.push(`What is affected: ${aff.join(", ")}`);
    if (casualties) {
      parts.push(`People trapped/injured/missing: ${CASUALTY_OPTIONS.find((c) => c.value === casualties)?.label ?? casualties}`);
    }
    if (observedSeverity) parts.push(`Reporter-observed severity: ${observedSeverity}`);
    if (observations.trim()) parts.push(`Additional observations: ${observations.trim()}`);
    if (loc?.address?.full_address) parts.push(`Location: ${loc.address.full_address}${loc.approximate ? " (approximate)" : ""}`);
    else if (loc) parts.push(`Location: ${loc.label}${loc.approximate ? " (approximate)" : ""}`);
    return parts.join("\n");
  }, [hazardType, whenHappened, whenExact, happeningNow, affected, affectedOther, casualties, observedSeverity, observations, loc]);

  async function analyze() {
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("text", description);
      if (reportContext) form.append("context", reportContext);
      if (hazardType) form.append("hazard_type", hazardType);
      if (image) form.append("image", image);
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = (await res.json()) as AnalyzeResponse & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Analysis failed.");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong while analysing the report.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const locValid = Boolean(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng));
      if (!locValid) {
        throw new Error("Please choose your location or a known place before publishing the report.");
      }

      const clientId = saveClientIdRef.current ?? (() => {
        const id = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `save_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        saveClientIdRef.current = id;
        return id;
      })();

      const preparedImage = image ? await prepareImage(image) : null;
      const imageData = preparedImage ? await fileToDataUrl(preparedImage) : undefined;
      const locationText = loc?.address?.full_address || loc?.label || customPlace.trim();
      const reporterDetails = {
        hazard_type: hazardType || undefined,
        when: whenHappened || undefined,
        when_exact: whenHappened === "exact" && whenExact ? whenExact : undefined,
        happening_now: happeningNow || undefined,
        affected: [...affected, ...(affectedOther.trim() ? [affectedOther.trim()] : [])],
        casualties: casualties || undefined,
        observed_severity: observedSeverity || undefined,
        observations: observations.trim() || undefined,
      };

      const res = await authFetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          location: locationText,
          lat: loc?.lat,
          lng: loc?.lng,
          coords_approximate: loc?.approximate ?? true,
          description: description.trim(),
          reporter_details: reporterDetails,
          image: imageData
            ? { name: preparedImage?.name, type: preparedImage?.type, data: imageData }
            : null,
        }),
      });
      const data = (await res.json()) as { incident?: { id: string; verification?: string }; error?: string; replayed?: boolean };
      if (res.status === 401) {
        setError("Your session expired. Please sign in again to publish this report.");
        setSaving(false);
        return;
      }
      if (!res.ok || !data.incident) throw new Error(data.error ?? "Could not save the report.");
      router.push(`/incident/${data.incident.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the report.");
      setSaving(false);
    }
  }

  const verdict = result?.verification as VerificationResult | undefined;
  const VerdictIcon = verdict ? VERDICT_STYLE[verdict.status].icon : null;

  /* ------------------------------ auth gate UI ------------------------------ */
  if (authLoading) {
    return (
      <div className="container-page py-16">
        <div className="flex items-center justify-center gap-3 muted"><Spinner className="h-5 w-5" /> Checking your session…</div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="container-page py-16 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: "var(--accent-soft)" }}>
          <ShieldCheck className="h-6 w-6" style={{ color: "var(--accent)" }} />
        </span>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in to report a hazard</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed muted">
          Reporting requires a verified account so every hazard report has an accountable owner and
          repeat submissions can be prevented. Browsing hazards stays open to everyone.
        </p>
        <div className="btn-row mt-6">
          <Link href="/login?next=/report" className="btn btn-primary">Sign in with phone</Link>
          <Link href="/" className="btn btn-secondary">Browse hazards instead</Link>
        </div>
      </div>
    );
  }

  const locValid = Boolean(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng));

  return (
    <div className="container-page py-6 sm:py-8">
      <header className="mb-6">
        <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">Report a hazard</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed muted">
          Describe what you can see. Your report is checked for evidence consistency before
          anything is published to people nearby. Reporting as <strong>{user?.display_name}</strong>.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* -------- main column -------- */}
        <div className="space-y-5">
          {/* hazard type — the anchor field, placed first for progressive disclosure */}
          <section className="card p-5">
            <label htmlFor="htype" className="text-[14px] font-semibold">Hazard type</label>
            <select
              id="htype"
              className="input mt-2 !py-2.5"
              value={hazardType}
              onChange={(e) => setHazardType(e.target.value as IncidentType | "")}
            >
              <option value="">Select the hazard you are reporting…</option>
              {HAZARD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="when" className="text-[13px] font-semibold muted">When did this happen?</label>
                <select id="when" className="input mt-1.5 !py-2" value={whenHappened} onChange={(e) => setWhenHappened(e.target.value)}>
                  <option value="">Select…</option>
                  {WHEN_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
                {whenHappened === "exact" && (
                  <input
                    type="datetime-local"
                    className="input mt-2 !py-2"
                    value={whenExact}
                    onChange={(e) => setWhenExact(e.target.value)}
                    aria-label="Exact date and time"
                  />
                )}
              </div>
              <div>
                <label htmlFor="now" className="text-[13px] font-semibold muted">Is it happening right now?</label>
                <div className="mt-1.5 flex rounded-lg border p-0.5" style={{ borderColor: "var(--border)" }} role="group">
                  {NOW_OPTIONS.map((n) => (
                    <button
                      key={n.value}
                      type="button"
                      aria-pressed={happeningNow === n.value}
                      onClick={() => setHappeningNow(n.value)}
                      className="flex-1 rounded-md px-2 py-1.5 text-[12.5px] font-semibold"
                      style={{
                        background: happeningNow === n.value ? "var(--accent-soft)" : "transparent",
                        color: happeningNow === n.value ? "var(--accent)" : "var(--text-2)",
                      }}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* description + voice */}
          <section className="card p-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="desc" className="text-[14px] font-semibold">What is happening?</label>
              <div className="flex items-center gap-2">
                <Languages className="h-3.5 w-3.5 faint" aria-hidden />
                <div className="flex overflow-hidden rounded-lg border text-[12px] font-medium" role="group" aria-label="Voice language" style={{ borderColor: "var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => setLang("en-IN")}
                    aria-pressed={lang === "en-IN"}
                    className="px-2.5 py-1"
                    style={lang === "en-IN" ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text-2)" }}
                  >
                    English
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang("hi-IN")}
                    aria-pressed={lang === "hi-IN"}
                    className="px-2.5 py-1"
                    style={lang === "hi-IN" ? { background: "var(--accent)", color: "#fff" } : { color: "var(--text-2)" }}
                  >
                    हिन्दी
                  </button>
                </div>
              </div>
            </div>
            <textarea
              id="desc"
              className="input min-h-[110px] resize-y"
              placeholder="e.g. Large rocks have fallen onto the road after heavy rain, near the bridge at Kullu…"
              value={description + (speech.interim ? ` ${speech.interim}` : "")}
              onChange={(e) => { setDescription(e.target.value); lastLenRef.current = speech.finalText.length; }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                disabled={!speech.supported}
                className={`btn ${speech.listening ? "btn-danger" : "btn-secondary"}`}
                aria-pressed={speech.listening}
              >
                {speech.listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                {speech.listening ? "Recording — listening…" : "Record voice description"}
              </button>
              {speech.listening && <span className="text-[12.5px]" style={{ color: "var(--danger)" }}>Listening… speak now</span>}
              {!speech.supported && (
                <span className="text-[12px] faint">Voice input is not available in this browser — you can type instead.</span>
              )}
            </div>
            {speech.error && <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>{speech.error}</p>}
          </section>

          {/* image */}
          <section className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[14px] font-semibold">Photo evidence <span className="faint font-normal">(strongly recommended)</span></span>
              {image && (
                <button type="button" className="btn btn-ghost !px-2 !py-1 text-[12px]" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }}>
                  <X className="h-3.5 w-3.5" aria-hidden /> Remove
                </button>
              )}
            </div>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Selected evidence preview" className="max-h-64 w-auto rounded-lg border" style={{ borderColor: "var(--border)" }} />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-[13px] muted transition hover:border-[var(--accent)]"
                style={{ borderColor: "var(--border)" }}
              >
                <ImagePlus className="h-5 w-5" aria-hidden />
                Add a photo of the hazard — it is reviewed together with your description
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onPickImage(e.target.files?.[0] ?? null)} />
          </section>

          {/* structured details — progressive disclosure */}
          <section className="card p-5">
            <span className="text-[14px] font-semibold">What is affected?</span>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {AFFECTED_OPTIONS.map((opt) => {
                const active = affected.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAffected((a) => (active ? a.filter((x) => x !== opt) : [...a, opt]))}
                    className="rounded-full border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{
                      borderColor: active ? "var(--accent)" : "var(--border)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      color: active ? "var(--accent)" : "var(--text-2)",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {affected.includes("Other") && (
              <input
                className="input mt-2.5 !py-2"
                placeholder="Describe what else is affected…"
                value={affectedOther}
                onChange={(e) => setAffectedOther(e.target.value)}
                aria-label="Other affected detail"
              />
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cas" className="text-[13px] font-semibold muted">Are people trapped, injured or missing?</label>
                <select id="cas" className="input mt-1.5 !py-2" value={casualties} onChange={(e) => setCasualties(e.target.value)}>
                  <option value="">Select…</option>
                  {CASUALTY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sev" className="text-[13px] font-semibold muted">Severity as you observe it</label>
                <select id="sev" className="input mt-1.5 !py-2" value={observedSeverity} onChange={(e) => setObservedSeverity(e.target.value)}>
                  <option value="">Select…</option>
                  {OBSERVED_SEVERITY.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <label htmlFor="obs" className="mt-4 block text-[13px] font-semibold muted">Additional observations <span className="faint font-normal">(optional)</span></label>
            <textarea
              id="obs"
              className="input mt-1.5 min-h-[64px] resize-y"
              placeholder="e.g. road completely blocked, water level rising fast, smoke visible, stranded vehicles on both sides…"
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
            />
          </section>

          {/* location */}
          <section className="card p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden />
              <span className="text-[14px] font-semibold">Where is it?</span>
              {resolvingAddress && (
                <span className="ml-auto flex items-center gap-1.5 text-[12px] muted"><Spinner className="h-3 w-3" /> Resolving address…</span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2.5 min-[420px]:flex min-[420px]:flex-wrap min-[420px]:items-center min-[420px]:gap-2">
              <button type="button" onClick={useMyLocation} disabled={locBusy} className="btn btn-secondary w-full min-[420px]:w-auto">
                {locBusy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" aria-hidden />}
                Use my location
              </button>
              <span className="hidden text-[12px] faint min-[420px]:inline">or</span>
              <div className="relative min-[420px]:w-auto">
                <select
                  className="input !py-2 pr-8"
                  value={loc?.preset ?? ""}
                  onChange={(e) => e.target.value && pickPreset(e.target.value)}
                  aria-label="Choose a nearby town"
                >
                  <option value="">choose a town…</option>
                  {LOCATIONS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 faint" aria-hidden />
              </div>
            </div>

            {/* Resolved address block — autofilled, editable, honest about precision */}
            <div className="mt-3">
              <label htmlFor="addr" className="text-[12.5px] font-semibold muted">Address / landmark</label>
              <textarea
                id="addr"
                className="input mt-1.5 min-h-[56px] resize-y"
                placeholder="Full address or landmark, e.g. Mall Road, Manali, Kullu, Himachal Pradesh…"
                value={loc?.label ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (loc) setAddress({ ...(loc.address ?? { full_address: v, lat: loc.lat, lng: loc.lng, approximate: true }), full_address: v });
                  else setCustom(v);
                }}
              />
              {loc?.address && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] muted">
                  {loc.address.locality && <span>Locality: {loc.address.locality}</span>}
                  {loc.address.district && <span>District: {loc.address.district}</span>}
                  {loc.address.state && <span>State: {loc.address.state}</span>}
                  {loc.address.pincode && <span>PIN: {loc.address.pincode}</span>}
                  {locValid && <span className="mono">Lat {loc.lat.toFixed(5)}, Lng {loc.lng.toFixed(5)}</span>}
                </div>
              )}
              {locValid && loc?.approximate && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--warn)" }}>
                  Approximate location — the address could not be resolved precisely. You can edit the address text above.
                </p>
              )}
              {locValid && !loc?.approximate && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--low)" }}>
                  Location detected from your device. Please verify before submitting.
                </p>
              )}
              {loc && !locValid && (
                <p className="mt-2 text-[12px]" style={{ color: "var(--warn)" }}>
                  No map coordinates for this place name — the report will show the name only.
                </p>
              )}
              {locError && <p className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>{locError}</p>}
            </div>

            <div className="mt-3 flex flex-col gap-2.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:gap-2">
              <input
                className="input flex-1 !py-2"
                placeholder="…or type a place (village, landmark, road)"
                value={customPlace}
                onChange={(e) => setCustomPlace(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && customPlace.trim()) { setCustom(customPlace); setCustomPlace(""); } }}
                aria-label="Custom location name"
              />
              <button type="button" className="btn btn-secondary shrink-0" disabled={!customPlace.trim()} onClick={() => { setCustom(customPlace); setCustomPlace(""); }}>
                Set
              </button>
              {loc && locValid && !loc.address && (
                <button type="button" className="btn btn-ghost shrink-0" onClick={async () => {
                  const addr = await reverseGeocode(loc.lat, loc.lng);
                  if (addr) setAddress(addr);
                }}>
                  Resolve address
                </button>
              )}
            </div>
          </section>

          {isOffline && (
            <div className="card p-4 text-[13px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }} role="status">
              You are offline. Fill in the report now — it will be saved on this device and uploaded
              automatically with the full AI evidence check once you&apos;re back online. Your device GPS
              coordinates are preserved as-is; the exact address is resolved after delivery.
            </div>
          )}

          {error && (
            <div className="card p-4 text-[13px]" style={{ background: "var(--danger-soft)", color: "var(--danger)" }} role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="card p-4 text-[13px]" style={{ background: "var(--low-soft)", color: "var(--low)" }} role="status">
              {notice}
            </div>
          )}

          <div className="sticky bottom-3 z-10">
            <div className="flex flex-col gap-2.5 rounded-xl border p-3 shadow-lg sm:flex-row sm:items-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              {isOffline ? (
                <button type="button" onClick={saveOffline} disabled={saving} className="btn btn-primary w-full">
                  {saving ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden />}
                  {saving ? "Saving…" : "Save report offline"}
                </button>
              ) : (
                <>
                  <button type="button" onClick={analyze} disabled={!canAnalyze} className="btn btn-primary w-full sm:w-auto">
                    {analyzing ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" aria-hidden />}
                    {analyzing ? "Verifying report…" : "Submit report"}
                  </button>
                  {result && result.verification.status !== "rejected" && (
                    <button type="button" onClick={save} disabled={saving} className="btn btn-primary w-full sm:w-auto">
                      {saving ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" aria-hidden />}
                      {saving ? "Publishing…" : result.verification.status === "verified" ? "Publish to nearby users" : "Save for review"}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          <DecisionTrace active={analyzing} verification={verdict ?? null} />

          {/* -------- verification result -------- */}
          {result && verdict && VerdictIcon && (
            <section className="space-y-5">
              <div className="card p-5" style={{ background: verdict.status === "verified" ? "var(--low-soft)" : verdict.status === "needs_review" ? "var(--warn-soft)" : "var(--danger-soft)" }}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`chip ${VERDICT_STYLE[verdict.status].chip} !text-[13px]`}>
                    <VerdictIcon className="h-4 w-4" aria-hidden />
                    {verdict.headline}
                  </span>
                  <SeverityChip severity={result.analysis.severity} />
                  <span className="chip chip-neutral">{result.analysis.incident_type}</span>
                  <span className="ml-auto"><ModeBadge aiAvailable={result.aiAvailable} /></span>
                </div>
                <p className="mt-3 text-[14px] leading-relaxed">{verdict.explanation}</p>

                <div className="mt-4">
                  <h3 className="mb-1.5 text-[13px] font-semibold">Evidence checks</h3>
                  <ul className="check-list">
                    {verdict.reasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                </div>
                {verdict.status === "rejected" && (
                  <p className="mt-4 text-[12.5px]" style={{ color: "var(--danger)" }}>
                    This report has not been published anywhere. If this is a real emergency, call 112.
                  </p>
                )}
              </div>

              <div className="card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[17px] font-bold">Assessment</h2>
                  <span className="ml-auto">
                    <EvidenceChip
                      assessment={
                        verdict.status === "verified" ? "Consistent" : verdict.status === "needs_review" ? "Unclear" : "Conflicting"
                      }
                    />
                  </span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed">{result.analysis.summary}</p>

                {result.analysis.severity_reasons && result.analysis.severity_reasons.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-1.5 text-[13px] font-semibold">Why {result.analysis.severity.toLowerCase()} priority?</h3>
                    <ul className="check-list">
                      {result.analysis.severity_reasons.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                )}

                {result.analysis.risk_factors.length > 0 && (
                  <div className="mt-4">
                    <h3 className="mb-1.5 text-[13px] font-semibold">Risk factors</h3>
                    <ul className="check-list">
                      {result.analysis.risk_factors.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <div className="card p-5">
                <h2 className="text-[15px] font-bold">Recommended actions</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--low)" }}>Do now</h3>
                    <ul className="check-list">
                      {result.analysis.immediate_actions.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-[13px] font-semibold" style={{ color: "var(--danger)" }}>Avoid</h3>
                    <ul className="check-list">
                      {result.analysis.avoid.map((a) => <li key={a}>{a}</li>)}
                    </ul>
                  </div>
                </div>
                {result.analysis.recommended_response && (
                  <p className="mt-4 text-[13.5px] leading-relaxed muted">
                    <Lightbulb className="mr-1.5 inline h-4 w-4" style={{ color: "var(--warn)" }} aria-hidden />
                    {result.analysis.recommended_response}
                  </p>
                )}
              </div>

              <EvidencePanel result={result} />
              <SourcesPanel sources={result.sources} />
              <p className="text-[11.5px] muted mt-2">
                AI checks whether the available report evidence is consistent. It does not determine whether
                a person is truthful.
              </p>
              <p className="text-[11.5px] faint">
                HillSense provides decision support only — it is not an official alert or emergency
                service. For life-threatening emergencies, call 112.
              </p>
            </section>
          )}
        </div>

        {/* -------- side column -------- */}
        <aside className="space-y-4">
          <div className="card p-5">
            <h2 className="mb-3 text-[14px] font-bold">What happens next?</h2>              <ol className="space-y-3 text-[13px] leading-relaxed muted">
              {[
                "Your description, photo and hazard details are read",
                "Evidence is checked for consistency",
                "Nearby reports are checked for duplicates & corroboration",
                "Relevant safety guidance is attached",
                "Reports with consistent evidence are published to people nearby",
              ].map((s, i) => (
                <li key={s} className="flex gap-2.5">
                  <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}>{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <div className="card p-5">
            <h2 className="mb-2 text-[14px] font-bold">How reports are reviewed</h2>
            <ul className="space-y-2.5 text-[12.5px] leading-relaxed muted">
              <li className="flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "var(--low)" }} aria-hidden /> Consistent evidence → eligible for public display.</li>
              <li className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--warn)" }} aria-hidden /> Unclear evidence → sent for review.</li>
              <li className="flex gap-2"><Ban className="h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} aria-hidden /> Conflicting evidence → held back for review.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}