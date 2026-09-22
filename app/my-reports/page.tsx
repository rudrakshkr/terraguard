"use client";

/**
 * My Reports — the signed-in member's own submissions only.
 *
 * This is a personal view, not an operator surface: it shows the state of every
 * report this account submitted (published, awaiting review, resolved, or not
 * published). Operational status changes stay in the Command Center.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardList, MapPin, Clock3, MessageSquare, UsersRound, ShieldCheck, Loader2,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { useAuth, authFetch } from "@/hooks/useAuth";
import { fmtAge, minutesSince } from "@/lib/geo";
import { reportTitle, publicationEventLabel, exampleReportLabel } from "@/lib/labels";
import { VerificationChip, SeverityChip } from "@/components/Badge";
import { corroborationProgressLabel, isReviewOnly } from "@/lib/community-policy";
import { Spinner } from "@/components/Spinner";

type GroupKey = "published" | "review" | "resolved" | "rejected";

function groupOf(i: Incident): GroupKey {
  if (i.verification === "rejected" || i.publication === "hidden") return "rejected";
  if (i.status === "Resolved") return "resolved";
  if (i.publication === "public") return "published";
  return "review";
}

const GROUP_META: Record<GroupKey, { title: string; hint: string }> = {
  published: { title: "Active / published", hint: "Live on the public alert feed." },
  review: { title: "Needs community review", hint: "Awaiting independent first-hand observations." },
  resolved: { title: "Resolved", hint: "No longer an active hazard." },
  rejected: { title: "Not published", hint: "Visible only to you — the submission had no usable evidence." },
};

const ORDER: GroupKey[] = ["published", "review", "resolved", "rejected"];

export default function MyReportsPage() {
  const router = useRouter();
  const { authed, loading } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!loading && !authed) router.replace("/login?next=/my-reports");
  }, [loading, authed, router]);

  useEffect(() => {
    if (loading || !authed) return;
    let cancelled = false;
    void (async () => {
      setRefreshing(true);
      setError(null);
      try {
        const res = await authFetch("/api/incidents?mine=1", { cache: "no-store" });
        const data = (await res.json()) as { incidents?: Incident[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not load your reports.");
        if (!cancelled) setIncidents(data.incidents ?? []);
      } catch (err) {
        if (!cancelled) {
          setIncidents([]);
          setError(err instanceof Error ? err.message : "Could not load your reports.");
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, authed]);

  const grouped = useMemo(() => {
    const out: Record<GroupKey, Incident[]> = { published: [], review: [], resolved: [], rejected: [] };
    for (const i of incidents ?? []) out[groupOf(i)].push(i);
    for (const k of ORDER) {
      out[k].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    return out;
  }, [incidents]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!authed) return null;

  return (
    <div className="container-page mx-auto max-w-3xl py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight sm:text-2xl">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--accent-soft)" }}>
            <ClipboardList className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} aria-hidden />
          </span>
          My Reports
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed muted">
          Every hazard report you submitted, and its current state. Only you can see this list.
        </p>
        {refreshing && (
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px] faint" role="status">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
          </p>
        )}
      </header>

      {error && (
        <p className="card mb-4 p-4 text-[13px]" style={{ color: "var(--danger)" }} role="alert">
          {error}
        </p>
      )}

      {incidents === null ? (
        <ul className="grid gap-3" aria-busy="true">
          {[0, 1].map((n) => (
            <li key={n} className="card p-4" aria-hidden>
              <div className="h-5 w-24 animate-pulse rounded-full" style={{ background: "var(--surface-2)" }} />
              <div className="mt-3 h-4 w-1/2 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
              <div className="mt-2 h-3.5 w-3/4 animate-pulse rounded" style={{ background: "var(--surface-2)" }} />
            </li>
          ))}
        </ul>
      ) : (incidents ?? []).length === 0 ? (
        <div className="card px-5 py-8 text-center">
          <ShieldCheck className="mx-auto h-7 w-7" style={{ color: "var(--low)" }} aria-hidden />
          <p className="mt-3 text-[15px] font-semibold">You haven&apos;t reported a hazard yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed muted">
            Reports you submit appear here with their evidence check and publication state.
          </p>
          <Link href="/report" className="btn btn-primary mt-4 inline-flex">
            Report a hazard
          </Link>
        </div>
      ) : (
        <div className="stack-lg">
          {ORDER.filter((k) => grouped[k].length > 0).map((k) => (
            <section key={k} aria-labelledby={`group-${k}`}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                <h2 id={`group-${k}`} className="text-[13px] font-bold uppercase tracking-wider muted">
                  {GROUP_META[k].title}
                </h2>
                <span className="text-[11.5px] faint">{GROUP_META[k].hint}</span>
                <span className="chip chip-neutral !text-[10.5px]">{grouped[k].length}</span>
              </div>
              <ul className="grid gap-3">
                {grouped[k].map((i) => {
                  const reviewOnly = isReviewOnly(i);
                  const yes = i.confirmations_yes ?? 0;
                  const reported =
                    i.origin === "seed" ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`;
                  return (
                    <li key={i.id}>
                      <Link
                        href={`/incident/${i.id}`}
                        className="card block p-4 transition hover:border-[var(--accent)]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityChip severity={i.severity} />
                          <VerificationChip verification={i.verification} />
                          <span className="chip chip-neutral !text-[10.5px]">{publicationEventLabel(i)}</span>
                        </div>
                        <p className="mt-2.5 text-[15px] font-semibold">{reportTitle(i)}</p>
                        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed muted">{i.summary}</p>
                        <div className="meta-row mt-2.5 muted">
                          <span>
                            <MapPin className="h-3.5 w-3.5" aria-hidden /> {i.location}
                          </span>
                          <span>
                            <Clock3 className="h-3.5 w-3.5" aria-hidden /> {reported}
                          </span>
                          {i.status !== "Resolved" && (
                            <span>
                              <UsersRound className="h-3.5 w-3.5" aria-hidden />{" "}
                              {reviewOnly
                                ? corroborationProgressLabel(yes)
                                : `${yes} independent observation${yes === 1 ? "" : "s"}`}
                            </span>
                          )}
                          {(i.comment_count ?? 0) > 0 && (
                            <span>
                              <MessageSquare className="h-3.5 w-3.5" aria-hidden /> {i.comment_count}
                            </span>
                          )}
                        </div>
                        {k === "review" && (
                          <p className="mt-2 text-[11.5px] faint">
                            You cannot confirm your own report — independent community observations corroborate it.
                          </p>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-6 text-[11.5px] faint">
        Operational status is managed by authorized HillSense operators. Report content and evidence checks are the
        same as those shown on the public incident page.
      </p>
    </div>
  );
}
