/** @file app/map/page.tsx — user-facing public incident map. */

"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { LocateFixed, WifiOff, Loader2 } from "lucide-react";
import type { Incident } from "@/lib/types";
import { useLocationPreference } from "@/hooks/useLocationPreference";
import { useAuth } from "@/hooks/useAuth";

import { Spinner } from "@/components/Spinner";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="card flex h-[420px] items-center justify-center">
      <Spinner className="h-5 w-5" />
    </div>
  ),
});

export default function MapPage() {
  const { loc, busy: geoBusy, useMyLocation: locate } = useLocationPreference();
  const { loading: authLoading } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [revalidating, setRevalidating] = useState(false);
  const [cachedFetchedAt, setCachedFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    void (async () => {
      // Cache-first: a previously loaded public list renders instantly.
      try {
        const { getCachedList } = await import("@/lib/offline-db");
        const cached = await getCachedList();
        const list = (cached?.incidents ?? []) as Incident[];
        if (!cancelled && list.length > 0) {
          setIncidents(list);
          setCachedFetchedAt(cached?.fetched_at ?? null);
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
        setCachedFetchedAt(null);
        try {
          const { putCachedList } = await import("@/lib/offline-db");
          await putCachedList(d.incidents ?? []);
        } catch {
          /* best-effort */
        }
      } catch {
        if (cancelled) return;
        try {
          const { getCachedList } = await import("@/lib/offline-db");
          const cached = await getCachedList();
          if (cancelled) return;
          setIncidents((cached?.incidents as Incident[]) ?? []);
          if (cached) setCachedFetchedAt(cached.fetched_at);
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
  }, [authLoading]);

  // The shared location preference already drives the whole app, so /map
  // centers on the same place as Nearby and My Feed. Derived (not state) so a
  // location change re-renders in the same pass with no extra effect.
  const userMarker = useMemo(
    () =>
      loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
        ? { lat: loc.lat, lng: loc.lng, label: loc.label }
        : null,
    [loc],
  );

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="container-page mx-auto max-w-6xl py-4 sm:py-6">
      {/* Page header — the map is the primary content; keep the chrome light. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">Public map</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed muted">
            Published active incidents across the current location. Tap a marker for a quick preview.
          </p>
          {cachedFetchedAt && (
            <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--warn)" }} role="status">
              <WifiOff className="h-3.5 w-3.5" aria-hidden />
              Saved copy from {new Date(cachedFetchedAt).toLocaleString()} — not live information.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revalidating && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] faint" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
            </span>
          )}
          <button
            type="button"
            onClick={() => void locate()}
            disabled={geoBusy}
            className="btn btn-secondary"
            aria-label="Center the map on your current location"
          >
            {geoBusy ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <LocateFixed className="h-4 w-4" aria-hidden />
            )}
            Locate me
          </button>
        </div>
      </div>

      {/* Map is the primary content; keep controls inside the viewport. */}
      <section className="card p-3" aria-label="Public incident map">
        <IncidentMap incidents={incidents ?? []} userLoc={userMarker} locateMe={() => void locate()} />
      </section>

      <p className="mt-2 text-[11px] faint">
        Base map © OpenStreetMap contributors. Markers show published active incidents within the current
        location and radius — review-only reports are not shown here.
      </p>
    </div>
  );
}
