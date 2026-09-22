"use client";

import Link from "next/link";
import { ArrowRight, Clock3, MapPin, MessageSquare, RefreshCw, ShieldCheck, UsersRound } from "lucide-react";
import type { Incident } from "@/lib/types";
import { fmtAge, fmtDistance, minutesSince } from "@/lib/geo";
import { exampleReportLabel, publicationBadgeLabel, reportTitle } from "@/lib/labels";
import { PUBLICATION_THRESHOLD } from "@/lib/community-policy";

/**
 * One hazard card used by the public feed, My Feed and the community review
 * queue. Fast to scan: state, title, one-line summary, then a compact metadata
 * row. Cards never carry more than a few fields.
 *
 * `tone="review"` is for not-yet-published reports: the severity is shown in a
 * neutral chip so a critical-but-unverified report never looks like an official
 * red alert, and the state badge says NEEDS REVIEW.
 */
export function HazardCard({
  incident: i,
  km = null,
  tone = "public",
  isOwnReport = false,
}: {
  incident: Incident;
  km?: number | null;
  tone?: "public" | "review";
  isOwnReport?: boolean;
}) {
  const isExample = i.origin === "seed";
  const severityClass = tone === "review" ? "chip-neutral" : `chip-${i.severity.toLowerCase()}`;
  const stateClass = tone === "review" ? "chip-warn" : i.publication === "public" && i.verification === "needs_review" ? "chip-low" : "chip-info";
  const yes = i.confirmations_yes ?? 0;
  const comments = i.comment_count ?? 0;
  const distance = km != null && Number.isFinite(km) ? fmtDistance(km) : null;

  return (
    /* min-w-0 is load-bearing: grid items default to min-width:auto, and the
       nowrap+truncate location line would otherwise force every card in the
       list to the width of the longest address (overflowing 320px screens). */
    <li className="min-w-0">
      <Link
        href={`/incident/${i.id}`}
        className="card fade-up block w-full p-4 transition hover:-translate-y-px"
        style={tone === "review" ? { borderColor: "color-mix(in srgb, var(--warn) 32%, var(--border))" } : undefined}
        aria-label={`${reportTitle(i)}, ${i.severity} severity, ${publicationBadgeLabel(i)}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${severityClass} shrink-0`}>
            <span className="dot" />
            {i.severity.toUpperCase()}
          </span>
          <span className={`chip ${stateClass} shrink-0`}>
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {publicationBadgeLabel(i)}
          </span>
          {isOwnReport && <span className="chip chip-neutral shrink-0">YOUR REPORT</span>}
          {isExample && (
            <span className="chip chip-neutral ml-auto shrink-0 !text-[10.5px]">DEMO DATA</span>
          )}
        </div>

        <h3 className="mt-2.5 text-[15px] font-semibold leading-snug">{reportTitle(i)}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-relaxed muted">{i.summary}</p>

        <div className="meta-row mt-2.5 muted">
          <span className="max-w-full truncate">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {distance ? `${distance} · ${i.location}` : i.location}
          </span>
          <span>
            <Clock3 className="h-3.5 w-3.5" aria-hidden />
            {isExample ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`}
          </span>
          {tone === "review" || scanUpdated(i) ? (
            <span>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              {yes > 0
                ? `Community confirmation · ${fmtAge(minutesSince(i.last_confirmed_at ?? i.created_at))}`
                : `Last updated ${fmtAge(minutesSince(i.last_confirmed_at ?? i.created_at))}`}
            </span>
          ) : null}
          <span>
            <UsersRound className="h-3.5 w-3.5" aria-hidden />
            {tone === "review"
              ? `${Math.min(yes, PUBLICATION_THRESHOLD)} of ${PUBLICATION_THRESHOLD} confirmations`
              : `${yes} confirmation${yes === 1 ? "" : "s"}`}
          </span>
          {comments > 0 && (
            <span>
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {comments} {comments === 1 ? "update" : "updates"}
            </span>
          )}
        </div>

        <span className="mt-3 inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: "var(--accent)" }}>
          Open incident
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </Link>
    </li>
  );
}

/** Only add the updated line while it carries information (recent or never confirmed). */
function scanUpdated(i: Incident): boolean {
  const mins = minutesSince(i.last_confirmed_at ?? i.created_at);
  return mins <= 24 * 60;
}

export default HazardCard;
