"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  LocateFixed, ShieldCheck, List, Map as MapIcon, Phone, LogIn, Search, WifiOff, Loader2,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { useLocationPreference, PRESETS } from "@/hooks/useLocationPreference";
import { useAuth, authFetch } from "@/hooks/useAuth";
import { haversineKm, needsReconfirmation } from "@/lib/geo";
import { HazardCard } from "@/components/HazardCard";
import { Spinner } from "@/components/Spinner";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="card flex h-[320px] items-center justify-center sm:h-[380px]">
      <Spinner className="h-5 w-5" />
    </div>
  ),
});

/** Fixed-height placeholder so the review section never shifts the layout. */
function ReviewSkeleton() {
  return (
    <ul className="grid gap-3" aria-busy="true">
      {[0, 1].map((n) => (
        <li key={n} className="card p-4" aria-hidden>
          <div className="flex items-center gap-2">
            <span className="h-5 w-20 animate-pulse rounded-full" style={{ background: "var(--surface-2)" }} />
            <span className="h-5 w-24 animate-pulse rounded-full" style={{ background: "var(--surface-2)" }} />
          </div>
          <div className="mt-3 h-4 w-1/2 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
          <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
        </li>
      ))}
    </ul>
  );
}

export default function NearbyPage() {
  const {
    loc, busy: geoBusy, resolvingAddress, error: geoError, useMyLocation, pickPreset, setCustom,
  } = useLocationPreference();
  const { authed, loading: authLoading, user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [review, setReview] = useState<Incident[] | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [radius, setRadius] = useState(25);
  const [customPlace, setCustomPlace] = useState("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [revalidating, setRevalidating] = useState(false);

  /* ---- Public alerts: render the stored copy instantly, then revalidate. ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getCachedList } = await import("@/lib/offline-db");
        const cached = await getCachedList();
        const list = (cached?.incidents ?? []) as Incident[];
        if (!cancelled && list.length > 0) {
          setIncidents(list);
          setRevalidating(true);
        }
      } catch {
        /* IndexedDB unavailable */
      }
      try {
        const res = await fetch("/api/incidents?public=1", { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const d = (await res.json()) as { incidents?: Incident[] };
        if (cancelled) return;
        setIncidents(d.incidents ?? []);
        setCachedAt(null);
        try {
          const { putCachedList } = await import("@/lib/offline-db");
          await putCachedList(d.incidents ?? []);
        } catch {
          /* storage unavailable */
        }
      } catch {
        if (cancelled) return;
        // Offline: fall back to the last stored list, clearly labelled as cached.
        try {
          const { getCachedList } = await import("@/lib/offline-db");
          const cached = await getCachedList();
          if (cancelled) return;
          setIncidents((cached?.incidents as Incident[]) ?? []);
          if (cached) setCachedAt(cached.fetched_at);
        } catch {
          if (!cancelled) setIncidents([]);
        }
      } finally {
        if (!cancelled) setRevalidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Community reports nearby: signed-in users only, independent request. ---- */
  useEffect(() => {
    // Guests never request — or see — the community review layer.
    if (authLoading || !authed) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/incidents?community_review=1", { cache: "no-store" });
        if (!res.ok) throw new Error("review load failed");
        const d = (await res.json()) as { incidents?: Incident[] };
        if (!cancelled) setReview(d.incidents ?? []);
      } catch {
        if (!cancelled) setReview([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, authed]);

  // Public feed = safety-checked, publicly published alerts only.
  const publicIncidents = useMemo(
    () =>
      (incidents ?? []).filter(
        (i) =>
          i.publication === "public" ||
          (i.publication == null && i.verification !== "rejected" && i.verification !== "needs_review"),
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

  /** Review reports ranked by distance where a location is known. */
  const reviewNearby = useMemo(() => {
    const withKm = (review ?? []).map((i) => ({
      i,
      km: locValid && loc ? haversineKm(loc.lat, loc.lng, i.lat, i.lng) : null,
    }));
    return withKm
      .filter(({ km }) => (locValid ? (km ?? 0) <= Math.max(radius, 50) : true))
      .sort((a, b) => {
        if (a.km != null && b.km != null) return a.km - b.km;
        return new Date(b.i.created_at).getTime() - new Date(a.i.created_at).getTime();
      })
      .slice(0, 6);
  }, [review, loc, locValid, radius]);

  const counts = useMemo(() => {
    const active = publicIncidents.filter((i) => i.status !== "Resolved");
    return {
      total: active.length,
      critical: active.filter((i) => i.severity === "Critical").length,
    };
  }, [publicIncidents]);

  const statusLine =
    locValid && loc
      ? `${loc.approximate ? `${loc.label} (approximate)` : loc.label} · ${counts.total} active public alert${counts.total === 1 ? "" : "s"}${counts.critical > 0 ? ` · ${counts.critical} critical` : ""}`
      : loc
        ? `Showing public alerts for “${loc.label}” — use your device location for distance filtering.`
        : "Allow location access to see hazards near you.";

  return (
    <div className="container-page py-6 sm:py-8">
      {/* ---- Heading row ---- */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">Hazards near you</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed muted">{statusLine}</p>
          {cachedAt && (
            <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--warn)" }} role="status">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Saved copy from {new Date(cachedAt).toLocaleString()} — not live information.
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
                {v === "list" ? <List className="h-4 w-4" aria-hidden /> : <MapIcon className="h-4 w-4" aria-hidden />}
                {v}
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* ---- Location controls ---- */}
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

        {loc && !loc.preset && (
          <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center" style={{ borderColor: "var(--border)" }}>
            <p className="min-w-0 flex-1 text-[12.5px] muted">
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
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && customPlace.trim()) {
                      setCustom(customPlace);
                      setCustomPlace("");
                    }
                  }}
                  aria-label="Set location by name"
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm shrink-0"
                disabled={!customPlace.trim()}
                onClick={() => {
                  if (customPlace.trim()) {
                    setCustom(customPlace);
                    setCustomPlace("");
                  }
                }}
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

      {/* ---- Public alerts ---- */}
      <div className="mt-5 mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-[13px] font-bold uppercase tracking-wider muted">Public alerts</h2>
        {revalidating && (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] faint" role="status">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
          </span>
        )}
      </div>

      {incidents === null ? (
        <div className="card flex h-56 items-center justify-center" aria-busy="true">
          <Spinner className="h-6 w-6" />
        </div>
      ) : nearby.length === 0 ? (
        <div className="card px-5 py-8 text-center">
          <ShieldCheck className="mx-auto h-7 w-7" style={{ color: "var(--low)" }} aria-hidden />
          <p className="mt-3 text-[15px] font-semibold">No active hazards reported in this area</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed muted">
            {loc
              ? "Nothing within your selected radius right now. Alerts appear here once community reports are published."
              : "Choose a location to see safety-checked public alerts, or report a hazard you have seen."}
          </p>
        </div>
      ) : view === "map" ? (
        <div className="card p-3">
          <IncidentMap
            incidents={nearby}
            userLoc={locValid && loc ? { lat: loc.lat, lng: loc.lng, label: loc.label } : null}
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:gap-4">
          {nearby.map((i) => (
            <HazardCard
              key={i.id}
              incident={i}
              km={locValid && loc ? haversineKm(loc.lat, loc.lng, i.lat, i.lng) : null}
              isOwnReport={Boolean(user?.id && i.reporter_id === user.id)}
            />
          ))}
        </ul>
      )}

      {/* ---- Community reports nearby: signed-in only, clearly separate from alerts ---- */}
      {authed && (
        <section className="mt-8" aria-labelledby="nearby-review-heading">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2
              id="nearby-review-heading"
              className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider muted"
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Community reports nearby
            </h2>
            {review !== null && review.length > 0 && (
              <span className="chip chip-warn">
                {review.length} {review.length === 1 ? "needs" : "need"} confirmation
              </span>
            )}
          </div>
          <p className="mb-3 max-w-3xl text-[12.5px] leading-relaxed muted">
            These reports have not passed the automatic evidence check. First-hand community observations can help
            corroborate them.
          </p>

          {review === null ? (
            <ReviewSkeleton />
          ) : reviewNearby.length === 0 ? (
            <p className="card p-4 text-[13px] muted">Nothing awaiting community confirmation near you.</p>
          ) : (
            <ul className="grid gap-3">
              {reviewNearby.map(({ i, km }) => (
                <HazardCard key={i.id} incident={i} km={km} tone="review" isOwnReport={Boolean(user?.id && i.reporter_id === user.id)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ---- Bottom banners ---- */}
      <div className="stack-lg mt-6">
        {!authed && (
          <div className="card banner">
            <span className="banner-icon" style={{ background: "var(--accent-soft)" }}>
              <LogIn className="h-4 w-4" style={{ color: "var(--accent)" }} aria-hidden />
            </span>
            <p className="min-w-0 flex-1 muted">
              <strong style={{ color: "var(--text)" }}>Browsing is open to everyone.</strong> Sign in with your phone
              number to report hazards, confirm alerts, and join the discussion.
            </p>
            <Link href="/login?next=/onboarding" className="btn btn-secondary btn-sm shrink-0">
              Sign in
            </Link>
          </div>
        )}

        <div
          className="card banner"
          style={{ background: "var(--danger-soft)", borderColor: "color-mix(in srgb, var(--danger) 22%, transparent)" }}
        >
          <span className="banner-icon" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)" }}>
            <Phone className="h-4 w-4" style={{ color: "var(--danger)" }} aria-hidden />
          </span>
          <p className="min-w-0 muted">
            <strong style={{ color: "var(--danger)" }}>In a life-threatening emergency, call 112.</strong> HillSense is
            decision support, not an official alert channel.
          </p>
        </div>

        {nearby.length > 0 && nearby.some((i) => needsReconfirmation(i)) && (
          <p className="px-1 text-[12px] faint">
            Some alerts have not been reconfirmed recently — check the incident page before travelling.
          </p>
        )}
      </div>
    </div>
  );
}
