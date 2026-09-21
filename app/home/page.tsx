"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Clock, Radio, ShieldCheck, Phone, Navigation, Siren, MessageSquare } from "lucide-react";
import type { Incident } from "@/lib/types";
import { useAuth, authFetch } from "@/hooks/useAuth";
import { haversineKm, fmtDistance, fmtAge, freshnessOf, minutesSince } from "@/lib/geo";
import { exampleReportLabel, activityLabel } from "@/lib/labels";
import { Spinner } from "@/components/Spinner";

/**
 * Personalized post-login landing page: verified active hazards ranked by
 * severity, distance from the user's saved profile location, recency, and
 * last-confirmed time. Stale/rejected/needs-review items are never shown as
 * fresh alerts.
 */
export default function HomePage() {
  const router = useRouter();
  const { user, authed, loading } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [profileLoc, setProfileLoc] = useState<{ lat: number; lng: number; label?: string } | null>(null);

  useEffect(() => {
    if (!loading && !authed) {
      router.replace("/login?next=/home");
    }
  }, [loading, authed, router]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem("hillsense-location");
        if (raw) {
          const loc = JSON.parse(raw) as { lat: number; lng: number; label?: string };
          if (Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) setProfileLoc(loc);
        }
      } catch {
        /* ignore */
      }

      authFetch("/api/incidents?public=1", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setIncidents(d.incidents ?? []))
        .catch(() => setIncidents([]));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const ranked = useMemo(() => {
    if (!incidents) return [];
    const sevRank = (s: string) => (s === "Critical" ? 0 : s === "High" ? 1 : s === "Moderate" ? 2 : 3);
    const withKm = incidents.map((i) => ({
      i,
      km: profileLoc ? haversineKm(profileLoc.lat, profileLoc.lng, i.lat, i.lng) : null,
    }));
    if (profileLoc) {
      // Nearby first: within 50 km prioritized, then severity, recency, confirmations.
      return withKm.sort((a, b) => {
        const aNear = (a.km ?? 9999) <= 50 ? 0 : 1;
        const bNear = (b.km ?? 9999) <= 50 ? 0 : 1;
        if (aNear !== bNear) return aNear - bNear;
        const sev = sevRank(a.i.severity) - sevRank(b.i.severity);
        if (sev !== 0) return sev;
        const conf = (b.i.confirmations_yes ?? 0) - (a.i.confirmations_yes ?? 0);
        if (conf !== 0) return conf;
        return new Date(b.i.created_at).getTime() - new Date(a.i.created_at).getTime();
      });
    }
    return withKm.sort((a, b) => {
      const sev = sevRank(a.i.severity) - sevRank(b.i.severity);
      if (sev !== 0) return sev;
      return new Date(b.i.created_at).getTime() - new Date(a.i.created_at).getTime();
    });
  }, [incidents, profileLoc]);

  if (loading) {
    return (
      <div className="container-page py-16">
        <div className="flex items-center justify-center gap-3 muted"><Spinner className="h-5 w-5" /> Loading…</div>
      </div>
    );
  }
  if (!authed) return null;

  const fresh = ranked.filter(({ i }) => freshnessOf(i) !== "stale");
  const stale = ranked.filter(({ i }) => freshnessOf(i) === "stale");

  return (
    <div className="container-page py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">
            Welcome{user?.display_name ? `, ${user.display_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed muted">
            {profileLoc ? "Safety-checked community reports near your saved location." : "Safety-checked community reports across Himachal Pradesh — add a location on your profile for nearby alerts."}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 min-[420px]:flex min-[420px]:flex-row sm:shrink-0">
          <Link href="/" className="btn btn-secondary"><Navigation className="h-4 w-4" /> Public map</Link>
          <Link href="/report" className="btn btn-primary"><Siren className="h-4 w-4" /> Report Hazard</Link>
        </div>
      </div>

      {incidents === null ? (
        <div className="card flex h-56 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : ranked.length === 0 ? (
        <div className="card p-10 text-center">
          <ShieldCheck className="mx-auto h-8 w-8" style={{ color: "var(--low)" }} />
          <p className="mt-3 font-semibold">No verified hazards right now</p>
          <p className="mx-auto mt-1 max-w-md text-[13.5px] muted">
            When safety-checked community reports are published near you, they will appear here first.
          </p>
        </div>
      ) : (
        <>
          <ul className="grid gap-3">
            {fresh.map(({ i, km }) => <IncidentRow key={i.id} i={i} km={km} />)}
          </ul>
          {stale.length > 0 && (
            <>
              <h2 className="mb-3 mt-6 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wider muted">
                <Clock className="h-3.5 w-3.5" /> Older — needs reconfirmation
              </h2>
              <ul className="grid gap-3 opacity-80">
                {stale.map(({ i, km }) => <IncidentRow key={i.id} i={i} km={km} />)}
              </ul>
            </>
          )}
        </>
      )}

      <div className="card banner mt-6" style={{ background: "var(--danger-soft)", borderColor: "color-mix(in srgb, var(--danger) 22%, transparent)" }}>
        <span className="banner-icon" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)" }}>
          <Phone className="h-4 w-4" style={{ color: "var(--danger)" }} />
        </span>
        <p className="min-w-0 muted">
          <strong style={{ color: "var(--danger)" }}>In a life-threatening emergency, call 112.</strong>{" "}
          HillSense shows community reports whose evidence passed an AI consistency check — decision
          support, not an official alert channel.
        </p>
      </div>
    </div>
  );
}

function IncidentRow({ i, km }: { i: Incident; km: number | null }) {
  return (
    <li>
      <Link href={`/incident/${i.id}`} className="card fade-up block p-4 transition hover:-translate-y-px" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip chip-${i.severity.toLowerCase()}`}>
            <span className="dot" />
            {i.severity.toUpperCase()}
          </span>
          <span className="text-[15px] font-semibold">{i.incident_type}</span>
          <span className="chip chip-info ml-auto">
            <ShieldCheck className="h-3 w-3" />
            AI CHECK PASSED
          </span>
        </div>
        <p className="mt-2 text-[14px] leading-relaxed">{i.summary}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] muted">
          {km != null && Number.isFinite(km) && (
            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{fmtDistance(km)} · {i.location}</span>
          )}
          {(km == null || !Number.isFinite(km)) && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{i.location}</span>}
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {i.origin === "seed" ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`}
          </span>
          <span className="flex items-center gap-1">
            <Radio className="h-3.5 w-3.5" />
            {i.status === "Resolved"
              ? "Resolved"
              : activityLabel(i.confirmations_yes ?? 0, i.last_confirmed_at ?? i.created_at, i.origin === "seed")}
          </span>
          <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{i.comment_count ?? 0} {i.comment_count === 1 ? "comment" : "comments"}</span>
          {i.origin === "seed" && <span className="chip chip-neutral">DEMO DATA</span>}
        </div>
      </Link>
    </li>
  );
}
