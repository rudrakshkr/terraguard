"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock3, Loader2, Navigation, Phone, ShieldCheck, Siren, WifiOff } from "lucide-react";
import type { Incident } from "@/lib/types";
import { useAuth, authFetch } from "@/hooks/useAuth";
import { haversineKm, freshnessOf } from "@/lib/geo";
import { HazardCard } from "@/components/HazardCard";
import { Spinner } from "@/components/Spinner";

/**
 * My Feed — the signed-in landing page.
 *
 * The public alert feed and the community review queue load CONCURRENTLY as two
 * independent requests (neither waits for the other, and neither waits for
 * profile/auth round-trips: the session token is read from local storage
 * synchronously). Both sections render immediately as fixed-height skeletons so
 * the review queue can never pop in late and shift the layout.
 */

interface SavedLoc {
  lat: number;
  lng: number;
  label?: string;
}

/** The user's saved location, read synchronously (no request waterfall). */
function readSavedLocation(): SavedLoc | null {
  try {
    const raw = localStorage.getItem("hillsense-location");
    if (!raw) return null;
    const loc = JSON.parse(raw) as Partial<SavedLoc>;
    if (Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng)) {
      return { lat: loc.lat as number, lng: loc.lng as number, ...(loc.label ? { label: loc.label } : {}) };
    }
  } catch {
    /* private mode / malformed */
  }
  return null;
}

function sevRank(s: string): number {
  return s === "Critical" ? 0 : s === "High" ? 1 : s === "Moderate" ? 2 : 3;
}

/** Fixed-height placeholder — the layout does not move when real data arrives. */
function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <li className="card p-4" aria-hidden>
      <div className="flex items-center gap-2">
        <span className="h-5 w-20 animate-pulse rounded-full" style={{ background: "var(--surface-2)" }} />
        <span className="h-5 w-28 animate-pulse rounded-full" style={{ background: "var(--surface-2)" }} />
      </div>
      <div className="mt-3 h-4 w-3/5 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
      {Array.from({ length: lines }).map((_, n) => (
        <div
          key={n}
          className="mt-2 h-3.5 animate-pulse rounded"
          style={{ background: "var(--surface-2)", width: n === lines - 1 ? "70%" : "92%" }}
        />
      ))}
      <div className="mt-3 h-3.5 w-2/5 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
    </li>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { user, authed, loading } = useAuth();
  /** null = still loading (skeleton), array = resolved. */
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [review, setReview] = useState<Incident[] | null>(null);
  const [profileLoc, setProfileLoc] = useState<SavedLoc | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [cachedFetchedAt, setCachedFetchedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!loading && !authed) router.replace("/login?next=/home");
  }, [loading, authed, router]);

  /* ---- Public alert feed: cache-first, then revalidate. Never awaits auth. ---- */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let hadCache = false;
      try {
        const { getCachedList } = await import("@/lib/offline-db");
        const cached = await getCachedList();
        const list = (cached?.incidents ?? []) as Incident[];
        if (!cancelled && list.length > 0) {
          hadCache = true;
          setIncidents(list);
          setCachedFetchedAt(cached?.fetched_at ?? null);
          setRevalidating(true);
        }
      } catch {
        /* IndexedDB unavailable — the network request below still runs */
      }

      try {
        const res = await fetch("/api/incidents?public=1", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as { incidents?: Incident[] };
        if (cancelled) return;
        setIncidents(d.incidents ?? []);
        setOffline(false);
        try {
          const { putCachedList } = await import("@/lib/offline-db");
          await putCachedList(d.incidents ?? []);
        } catch {
          /* best-effort cache write */
        }
      } catch {
        if (cancelled) return;
        // Keep whatever the cache gave us rather than blanking the page.
        if (hadCache) setOffline(true);
        else setIncidents([]);
      } finally {
        if (!cancelled) setRevalidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Community review queue: independent request, starts as soon as the
     session is known (token read synchronously). Failure never affects the feed. ---- */
  useEffect(() => {
    if (loading || !authed) return;
    let cancelled = false;
    void (async () => {
      // Read the saved location locally (no request) and start the request
      // straight away — the review queue never waits on the public feed.
      const saved = readSavedLocation();
      setProfileLoc(saved);
      const query =
        saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)
          ? `&lat=${encodeURIComponent(saved.lat)}&lng=${encodeURIComponent(saved.lng)}&radius_km=50`
          : "";
      try {
        const res = await authFetch(`/api/incidents?community_review=1${query}`, { cache: "no-store" });
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
  }, [loading, authed]);

  const ranked = useMemo(() => {
    if (!incidents) return [];
    const withKm = incidents.map((i) => ({
      i,
      km: profileLoc ? haversineKm(profileLoc.lat, profileLoc.lng, i.lat, i.lng) : null,
    }));
    return withKm.sort((a, b) => {
      if (profileLoc) {
        const aNear = (a.km ?? 9999) <= 50 ? 0 : 1;
        const bNear = (b.km ?? 9999) <= 50 ? 0 : 1;
        if (aNear !== bNear) return aNear - bNear;
      }
      const sev = sevRank(a.i.severity) - sevRank(b.i.severity);
      if (sev !== 0) return sev;
      const conf = (b.i.confirmations_yes ?? 0) - (a.i.confirmations_yes ?? 0);
      if (conf !== 0) return conf;
      return new Date(b.i.created_at).getTime() - new Date(a.i.created_at).getTime();
    });
  }, [incidents, profileLoc]);

  const reviewRanked = useMemo(() => {
    const withKm = (review ?? []).map((i) => ({
      i,
      km: profileLoc ? haversineKm(profileLoc.lat, profileLoc.lng, i.lat, i.lng) : null,
    }));
    return withKm
      .sort((a, b) => {
        if (profileLoc) {
          const aNear = (a.km ?? 9999) <= 50 ? 0 : 1;
          const bNear = (b.km ?? 9999) <= 50 ? 0 : 1;
          if (aNear !== bNear) return aNear - bNear;
        }
        return new Date(b.i.created_at).getTime() - new Date(a.i.created_at).getTime();
      })
      .slice(0, 6);
  }, [review, profileLoc]);

  if (loading) {
    return (
      <div className="container-page py-16">
        <div className="flex items-center justify-center gap-3 muted">
          <Spinner className="h-5 w-5" /> Loading…
        </div>
      </div>
    );
  }
  if (!authed) return null;

  const fresh = ranked.filter(({ i }) => freshnessOf(i) !== "stale");
  const stale = ranked.filter(({ i }) => freshnessOf(i) === "stale");
  // Only split the list when there is something on both sides — otherwise a
  // lone "older" heading reads as an empty section.
  const splitFreshness = fresh.length > 0 && stale.length > 0;
  const firstName = user?.display_name ? user.display_name.split(" ")[0] : "";

  return (
    <div className="container-page py-6 sm:py-8">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">
            Hello{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-[13.5px] leading-relaxed muted">
            Public alerts ranked by distance and severity
            {profileLoc?.label ? ` from ${profileLoc.label}` : " across Himachal Pradesh"}.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 min-[420px]:flex-row sm:shrink-0">
          <Link href="/" className="btn btn-secondary">
            <Navigation className="h-4 w-4" aria-hidden /> Public map
          </Link>
          <Link href="/report" className="btn btn-primary">
            <Siren className="h-4 w-4" aria-hidden /> Report Hazard
          </Link>
        </div>
      </header>

      {/* ---------------- Public alerts (trusted layer) ---------------- */}
      <section aria-labelledby="home-public-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 id="home-public-heading" className="text-[13px] font-bold uppercase tracking-wider muted">
            Public alerts near you
          </h2>
          {revalidating && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] faint" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
            </span>
          )}
        </div>

        {offline && cachedFetchedAt && (
          <p className="mb-3 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--warn)" }} role="status">
            <WifiOff className="h-3.5 w-3.5" aria-hidden />
            Saved copy from {new Date(cachedFetchedAt).toLocaleString()} — not live information.
          </p>
        )}

        {incidents === null ? (
          <ul className="grid gap-3" aria-busy="true">
            <CardSkeleton />
            <CardSkeleton lines={1} />
          </ul>
        ) : ranked.length === 0 ? (
          <div className="card p-8 text-center">
            <ShieldCheck className="mx-auto h-8 w-8" style={{ color: "var(--low)" }} aria-hidden />
            <p className="mt-3 font-semibold">No public alerts right now</p>
            <p className="mx-auto mt-1 max-w-md text-[13.5px] muted">
              Safety-checked reports appear here as soon as they are published.
            </p>
          </div>
        ) : (
          <>
            {splitFreshness ? (
              <>
                <ul className="grid gap-3">
                  {fresh.map(({ i, km }) => (
                    <HazardCard key={i.id} incident={i} km={km} isOwnReport={Boolean(user?.id && i.reporter_id === user.id)} />
                  ))}
                </ul>
                <div className="mt-6">
                  <h3 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider muted">
                    <Clock3 className="h-3.5 w-3.5" aria-hidden /> Older — needs reconfirmation
                  </h3>
                  <ul className="grid gap-3 opacity-80">
                    {stale.map(({ i, km }) => (
                      <HazardCard key={i.id} incident={i} km={km} isOwnReport={Boolean(user?.id && i.reporter_id === user.id)} />
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <ul className="grid gap-3">
                {ranked.map(({ i, km }) => (
                  <HazardCard key={i.id} incident={i} km={km} isOwnReport={Boolean(user?.id && i.reporter_id === user.id)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ---------------- Community review queue (secondary layer) ---------------- */}
      <section className="mt-7" aria-labelledby="home-review-heading">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2
            id="home-review-heading"
            className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider muted"
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Community review queue
          </h2>
          {review !== null && review.length > 0 && (
            <span className="chip chip-warn">{review.length} awaiting review</span>
          )}
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed muted">
          Not yet checked automatically. First-hand community observations can help corroborate them.
        </p>

        {review === null ? (
          <ul className="grid gap-3" aria-busy="true">
            <CardSkeleton lines={1} />
            <CardSkeleton lines={2} />
          </ul>
        ) : review.length === 0 ? (
          <p className="card p-4 text-[13px] muted">
            No reports need community confirmation right now.
          </p>
        ) : (
          <ul className="grid gap-3">
            {reviewRanked.map(({ i, km }) => (
              <HazardCard
                key={i.id}
                incident={i}
                km={km}
                tone="review"
                isOwnReport={Boolean(user?.id && i.reporter_id === user.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <div
        className="card banner mt-6"
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
    </div>
  );
}
