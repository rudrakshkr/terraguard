"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, MapPin, ThumbsDown, ThumbsUp, UsersRound } from "lucide-react";
import type { Incident } from "@/lib/types";
import { useAuth, authFetch } from "@/hooks/useAuth";
import { Spinner } from "@/components/Spinner";
import { SeverityChip } from "@/components/Badge";
import { fmtAge, minutesSince } from "@/lib/geo";

export default function CommunityReviewPage() {
  const { authed, loading: authLoading, user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authed) return;
    setError(null);
    try {
      const res = await authFetch("/api/incidents?community_review=1", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load reports.");
      setIncidents(data.incidents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load community reports.");
    }
  }, [authed]);

  useEffect(() => {
    if (authLoading || !authed) return;
    // Deferred so the initial load never cascades a synchronous re-render.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [authLoading, authed, load]);

  async function confirm(id: string, response: "yes" | "no") {
    setBusyId(id);
    setNotice(null);
    setError(null);
    try {
      const res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", response }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not record your response.");

      if (data.published) {
        setNotice(`${id} was published after independent community corroboration.`);
      } else {
        setNotice(data.message ?? "Your response was recorded.");
      }

      if (data.incident?.publication === "public") {
        setIncidents((prev) => (prev ?? []).filter((i) => i.id !== id));
      } else if (data.incident) {
        setIncidents((prev) =>
          (prev ?? []).map((i) => (i.id === id ? (data.incident as Incident) : i)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your response.");
    } finally {
      setBusyId(null);
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="container-page mx-auto max-w-2xl py-16 text-center">
        <UsersRound className="mx-auto h-8 w-8" style={{ color: "var(--accent)" }} />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Sign in to review reports</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed muted">
          Community corroboration is available to signed-in users. One response per person is counted.
        </p>
        <Link href="/login?next=/community-review" className="btn btn-primary mt-6 inline-flex">
          Sign in with phone
        </Link>
      </div>
    );
  }

  return (
    <div className="container-page py-6 sm:py-10">
      <div className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] muted">
            <UsersRound className="h-3.5 w-3.5" style={{ color: "var(--accent)" }} />
            Community review
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Help verify reports near you.</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed muted">
            These reports were saved but could not be automatically verified. Confirm only hazards you can directly observe.
            Two independent “yes” confirmations can move a review-only report into the public alert feed.
          </p>
        </div>
        <button onClick={() => void load()} className="btn btn-secondary sm:shrink-0">
          Refresh
        </button>
      </div>

      {notice && (
        <div className="card mb-4 flex items-start gap-2.5 p-4 text-[13px]" style={{ color: "var(--low)" }}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="card mb-4 flex items-start gap-2.5 p-4 text-[13px]" style={{ color: "var(--danger)" }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {incidents === null ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="h-6 w-6" />
        </div>
      ) : incidents.length === 0 ? (
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8" style={{ color: "var(--low)" }} />
          <h2 className="mt-3 text-lg font-semibold">No review-only reports right now.</h2>
          <p className="mt-1 text-[13px] muted">New ambiguous reports will appear here for community corroboration.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {incidents.map((i) => {
            const count = i.confirmations_yes ?? 0;
            const isReporter = user?.id === i.reporter_id;
            const busy = busyId === i.id;

            return (
              <article key={i.id} className="card overflow-hidden p-5">
                {i.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.photo_url}
                    alt="Reported hazard evidence"
                    className="mb-4 h-48 w-full rounded-lg object-cover"
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <SeverityChip severity={i.severity} />
                  <span className="chip chip-warn">NEEDS REVIEW</span>
                  <span className="chip chip-neutral">{count}/2 confirmations</span>
                </div>

                <h2 className="mt-3 text-lg font-semibold">{i.summary}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed muted">{i.description}</p>

                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[12px] muted">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {i.location}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Reported {fmtAge(minutesSince(i.created_at))}
                  </span>
                </div>

                {isReporter ? (
                  <div className="mt-5 rounded-lg border p-3.5 text-[12.5px] muted" style={{ borderColor: "var(--border)" }}>
                    You submitted this report. Your response cannot count toward independent corroboration.
                  </div>
                ) : (
                  <div className="mt-5">
                    <p className="mb-2.5 text-[12.5px] font-semibold">Can you directly confirm this hazard?</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => void confirm(i.id, "yes")}
                        disabled={busy}
                        className="btn btn-primary w-full"
                      >
                        {busy ? <Spinner className="h-4 w-4" /> : <ThumbsUp className="h-4 w-4" />}
                        Yes, I can confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirm(i.id, "no")}
                        disabled={busy}
                        className="btn btn-secondary w-full"
                      >
                        <ThumbsDown className="h-4 w-4" />
                        No / not present
                      </button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  <span className="text-[11.5px] faint">
                    {count === 0 ? "First corroboration needed" : `${2 - Math.min(count, 2)} more independent confirmation${count >= 1 ? "" : "s"} needed`}
                  </span>
                  <Link href={`/incident/${i.id}`} className="text-[12px] font-semibold underline" style={{ color: "var(--accent)" }}>
                    View details
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}