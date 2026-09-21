"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  MapPin, LocateFixed, ShieldCheck, Clock, Radio,
  List, Map as MapIcon, Phone, LogIn, Search, Siren, WifiOff,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { useLocationPreference, PRESETS } from "@/hooks/useLocationPreference";
import { useAuth } from "@/hooks/useAuth";
import { haversineKm, fmtDistance, fmtAge, freshnessOf, minutesSince, needsReconfirmation } from "@/lib/geo";
import { exampleReportLabel, activityLabel } from "@/lib/labels";
import { Spinner } from "@/components/Spinner";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="card flex h-[380px] items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  ),
});

/** Reusable hazard card — one component, one padding system, aligned metadata. */
function HazardCard({ incident, km }: { incident: Incident; km: number | null }) {
  const i = incident;
  const isExample = i.origin === "seed";
  const confirmLabel =
    i.status === "Resolved"
      ? "Resolved"
      : activityLabel(i.confirmations_yes ?? 0, i.last_confirmed_at ?? i.created_at, isExample);

  return (
    <li>
      <Link
        href={`/incident/${i.id}`}
        className="card fade-up flex flex-col gap-2.5 p-4 transition hover:-translate-y-px sm:p-5"
        aria-label={`${i.incident_type}, ${i.severity} severity`}
      >
        {/* Header row: severity + type … AI CHECK PASSED pinned right */}
        <div className="flex items-center gap-2.5">
          <span className={`chip chip-${i.severity.toLowerCase()} shrink-0`}>
            <span className="dot" />
            {i.severity.toUpperCase()}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug">{i.incident_type}</h3>
          <span className="chip chip-info shrink-0">
            <ShieldCheck className="h-3 w-3" />
            AI CHECK PASSED
          </span>
        </div>

        {/* Summary */}
        <p className="text-[14px] leading-relaxed">{i.summary}</p>

        {/* Metadata — consistent 12.5px row, icons never squashed */}
        <div className="meta-row muted">
          <span className="max-w-[46%] truncate" title={i.location}>
            <MapPin className="h-3.5 w-3.5" />
            {km != null ? `${fmtDistance(km)} · ${i.location}` : i.location}
          </span>
          <span>
            <Clock className="h-3.5 w-3.5" />
            {isExample ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`}
          </span>
          <span>
            <Radio className="h-3.5 w-3.5" />
            {confirmLabel}
          </span>
          {i.origin === "seed" && (
            <span className="chip chip-neutral ml-auto !text-[10.5px]">DEMO DATA</span>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function NearbyPage() {
  const {
    loc, busy: geoBusy, resolvingAddress, error: geoError, useMyLocation, pickPreset, setCustom,
  } = useLocationPreference();
  const { authed } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [radius, setRadius] = useState(25);
  const [customPlace, setCustomPlace] = useState("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/incidents?public=1", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then(async (d) => {
          setIncidents(d.incidents ?? []);
          // Persist for offline browsing.
          try {
            const { putCachedList } = await import("@/lib/offline-db");
            await putCachedList(d.incidents ?? []);
          } catch { /* storage unavailable */ }
        })
        .catch(async () => {
          // Offline: show the last stored list, clearly labelled as cached.
          try {
            const { getCachedList } = await import("@/lib/offline-db");
            const cached = await getCachedList();
            setIncidents((cached?.incidents as Incident[]) ?? []);
            if (cached) setCachedAt(cached.fetched_at);
          } catch {
            setIncidents([]);
          }
        });
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Public feed = safety-checked, publicly published alerts only.
  const publicIncidents = useMemo(
    () =>
      (incidents ?? []).filter(
        (i) => i.publication === "public" || (i.publication == null && i.verification !== "rejected" && i.verification !== "needs_review"),
      ),
    [incidents],
  );

  const locValid = Boolean(loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng));

  const nearby = useMemo(() => {
    if (!locValid || !loc) return publicIncidents;
    return publicIncidents
      .map((i) => ({ i, km: haversineKm(loc.lat, loc.lng, i.lat, i.lng) }))
      .filter(({ km }) => km <= radius)
      .sort((a, b) => {
        const rank = (s: string) => (s === "Critical" ? 0 : s === "High" ? 1 : s === "Moderate" ? 2 : 3);
        return rank(a.i.severity) - rank(b.i.severity) || a.km - b.km;
      })
      .map(({ i }) => i);
  }, [publicIncidents, loc, radius, locValid]);

  const counts = useMemo(() => {
    const active = publicIncidents.filter((i) => i.status !== "Resolved");
    return {
      total: active.length,
      critical: active.filter((i) => i.severity === "Critical").length,
      fresh: active.filter((i) => freshnessOf(i) === "fresh").length,
    };
  }, [publicIncidents]);

  const statusLine = locValid && loc
    ? `${loc.approximate ? `${loc.label} (approximate)` : loc.label} · ${counts.total} active public alert${counts.total === 1 ? "" : "s"}${counts.critical > 0 ? ` · ${counts.critical} critical` : ""}`
    : loc
      ? `Showing public alerts for “${loc.label}” — use your device location for distance filtering.`
      : "Allow location access to see hazards near you.";

  return (
    <div className="container-page py-6 sm:py-8">
      {/* ---- Heading row: title/status left, toggle + CTA right, one aligned row ---- */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">Hazards near you</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13.5px] leading-relaxed muted">
            <MapPin className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
            <span className="min-w-0">{statusLine}</span>
          </p>
          {cachedAt && (
            <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--warn)" }} role="status">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Showing saved reports from your last visit ({new Date(cachedAt).toLocaleString()}) — not live information.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2.5 min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-end min-[420px]:gap-3 sm:shrink-0">
          <div className="segmented w-full min-[420px]:w-auto" role="tablist" aria-label="View mode">
            {(["list", "map"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className="capitalize"
              >
                {v === "list" ? <List className="h-4 w-4" /> : <MapIcon className="h-4 w-4" />}
                {v}
              </button>
            ))}
          </div>
          <Link href="/report" className="btn btn-primary w-full min-[420px]:w-auto">
            <Siren className="h-4 w-4" aria-hidden />
            Report Hazard
          </Link>
        </div>
      </div>

      {/* ---- Location controls: one row on desktop, clean wraps on mobile ---- */}
      <section className="card mt-5 p-4" aria-label="Location and filter controls">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <button onClick={useMyLocation} disabled={geoBusy} className="btn btn-secondary shrink-0">
            {geoBusy ? <Spinner className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" aria-hidden />}
            Use my location
          </button>

          {resolvingAddress && (
            <span className="flex items-center gap-1.5 text-[12.5px] muted" role="status">
              <Spinner className="h-3.5 w-3.5" /> Resolving address…
            </span>
          )}

          <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-2 sm:gap-x-3">
            <span className="text-[13px] muted">or choose</span>
            <select
              className="input btn-width min-w-0 sm:!w-auto sm:min-w-[9.5rem]"
              value={loc?.preset ?? ""}
              onChange={(e) => pickPreset(e.target.value)}
              aria-label="Choose location manually"
            >
              <option value="" disabled>choose a location…</option>
              {PRESETS.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>

            {locValid && (
              <label className="flex items-center gap-2 sm:ml-auto">
                <span className="text-[13px] muted">Radius</span>
                <select
                  className="input btn-width min-w-0 sm:!w-auto sm:min-w-[8.5rem]"
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  aria-label="Search radius"
                >
                  <option value={10}>10 km</option>
                  <option value={25}>25 km</option>
                  <option value={50}>50 km</option>
                  <option value={1000}>All of Himachal</option>
                </select>
              </label>
            )}
          </div>
        </div>

        {/* Resolved-address line (GPS) or manual-entry row — only when relevant */}
        {loc && !loc.preset && (
          <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center" style={{ borderColor: "var(--border)" }}>
            <p className="min-w-0 flex-1 truncate text-[12.5px] muted" title={loc.label}>
              <span style={{ color: "var(--text)" }}>{loc.label}</span>
              {loc.approximate && " · approximate"}
            </p>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 faint" aria-hidden />
                <input
                  className="input !pl-8 text-[13px]"
                  placeholder="Change by typing a place…"
                  value={customPlace}
                  onChange={(e) => setCustomPlace(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customPlace.trim()) { setCustom(customPlace); setCustomPlace(""); } }}
                  aria-label="Set location by name"
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                disabled={!customPlace.trim()}
                onClick={() => { if (customPlace.trim()) { setCustom(customPlace); setCustomPlace(""); } }}
              >
                Set
              </button>
            </div>
          </div>
        )}

        {geoError && (
          <p className="mt-3 border-t pt-3 text-[12.5px]" style={{ color: "var(--warn)", borderColor: "var(--border)" }} role="alert">
            {geoError}
          </p>
        )}
      </section>

      {/* ---- Feed ---- */}
      {incidents === null ? (
        <div className="card mt-4 flex h-64 items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : nearby.length === 0 ? (
        <div className="card mt-4 px-6 py-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8" style={{ color: "var(--low)" }} />
          <p className="mt-3 text-[15px] font-semibold">No active hazards reported in this area</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed muted">
            {loc
              ? "Nothing within your selected radius right now. Alerts appear here as soon as community reports are verified."
              : "Choose a location to see safety-checked public alerts, or report a hazard you have seen."}
          </p>
        </div>
      ) : view === "map" ? (
        <div className="card mt-4 p-3">
          <IncidentMap incidents={nearby} userLoc={locValid && loc ? { lat: loc.lat, lng: loc.lng, label: loc.label } : null} />
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:gap-4">
          {nearby.map((i) => (
            <HazardCard
              key={i.id}
              incident={i}
              km={locValid && loc ? haversineKm(loc.lat, loc.lng, i.lat, i.lng) : null}
            />
          ))}
        </ul>
      )}

      {/* ---- Bottom banners: one pattern, same width/padding/rhythm ---- */}
      <div className="stack-lg mt-6">
        {!authed && (
          <div className="card banner">
            <span className="banner-icon" style={{ background: "var(--accent-soft)" }}>
              <LogIn className="h-4 w-4" style={{ color: "var(--accent)" }} />
            </span>
            <p className="min-w-0 flex-1 muted">
              <strong style={{ color: "var(--text)" }}>Browsing is open to everyone.</strong> Sign in with
              your phone number to report hazards, confirm alerts, and join the discussion.
            </p>
            <Link href="/login?next=/onboarding" className="btn btn-secondary btn-sm shrink-0 sm:!btn">
              Sign in
            </Link>
          </div>
        )}

        <div className="card banner" style={{ background: "var(--danger-soft)", borderColor: "color-mix(in srgb, var(--danger) 22%, transparent)" }}>
          <span className="banner-icon" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)" }}>
            <Phone className="h-4 w-4" style={{ color: "var(--danger)" }} />
          </span>
          <p className="min-w-0 muted">
            <strong style={{ color: "var(--danger)" }}>In a life-threatening emergency, call 112.</strong>{" "}
            HillSense shows community reports whose evidence passed an AI consistency check — it is decision
            support, not an official alert channel. Always follow instructions from your district administration.
          </p>
        </div>

        {nearby.length > 0 && nearby.some((i) => needsReconfirmation(i)) && (
          <p className="flex items-center gap-1.5 px-1 text-[12px] faint">
            Some alerts have not been reconfirmed recently — check the incident page before travelling.
          </p>
        )}
      </div>
    </div>
  );
}


