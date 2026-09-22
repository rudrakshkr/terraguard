// User-facing labels and wording, shared across pages so terminology stays
// consistent (statuses, example-data timestamps, activity lines).
// Deliberately free of implementation terms (RAG, LLM, embeddings, scores).

export const STATUS_LABELS: Record<string, string> = {
  published: 'Published',
  review: 'In review',
  rejected: 'Not published',
  resolved: 'Resolved',
};

export function statusLabel(s?: string | null): string {
  return STATUS_LABELS[s || 'published'] || 'Published';
}

// Matches lib/hillsense.ts status values.
export function isPublicStatus(s?: string | null): boolean {
  return s === 'published' || s === 'resolved';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "21 Sep 2026"
export function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "21 Sep 2026 · 3:45 pm"
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${fmtDate(iso)} · ${h}:${m} ${ap}`;
}

// Dates for seeded "example" incidents are intentionally STATIC — a live
// "3 minutes ago" tick on demo data would be misleading in a demo.
// Used as: `Example report · ${fmtDate(report.created_at)}`
export function exampleReportLabel(iso?: string | null): string {
  const d = fmtDate(iso);
  return d ? `Example report · ${d}` : 'Example report';
}

export function exampleUpdateLabel(iso?: string | null): string {
  const d = fmtDate(iso);
  return d ? `Example update · ${d}` : 'Example update';
}

/* --------------------------------------------------------------------------
 * Report / publication wording
 *
 * A report's title is the hazard the REPORTER described. The AI classification
 * is secondary information ("AI interpretation: …") and must never be shown as
 * the established fact for a report that still needs review.
 * ------------------------------------------------------------------------ */

interface ReportWording {
  incident_type: string;
  verification?: string;
  publication?: string;
  reporter_details?: { hazard_type?: string; observed_severity?: string };
}

/** e.g. "Landslide report" — never only the AI's interpretation. */
export function reportTitle(i: Pick<ReportWording, "incident_type" | "reporter_details">): string {
  const declared = i.reporter_details?.hazard_type?.trim();
  return declared ? `${declared} report` : i.incident_type;
}

/** The AI's classification, only when it differs from what the reporter chose. */
export function aiInterpretationOf(
  i: Pick<ReportWording, "incident_type" | "reporter_details">,
): string | null {
  const declared = i.reporter_details?.hazard_type?.trim();
  return declared && declared !== i.incident_type ? i.incident_type : null;
}

/** Badge text for the publication/evidence state, used on cards and detail headers. */
export function publicationBadgeLabel(i: Pick<ReportWording, "verification" | "publication">): string {
  if (i.publication === "public" && i.verification === "needs_review") return "COMMUNITY CORROBORATED";
  if (i.verification === "verified") return "AI CHECK PASSED";
  if (i.verification === "needs_review") return "NEEDS REVIEW";
  return "NOT PUBLISHED";
}

/** Timeline language that matches the actual state — never "published" for a report still under review. */
export function publicationEventLabel(i: Pick<ReportWording, "verification" | "publication">): string {
  if (i.publication === "public" && i.verification === "needs_review") {
    return "Published after community corroboration";
  }
  if (i.publication === "public") return "Published to public feed";
  if (i.publication === "review_only") return "Saved for community review";
  return "Not published";
}

/** Heading for the collapsible evidence-reasoning block. */
export function reviewSectionTitle(i: Pick<ReportWording, "verification" | "publication">): string {
  if (i.publication === "public" && i.verification === "needs_review") return "Why this report needed review";
  if (i.verification === "verified") return "Why this report passed the AI check";
  return "Why is this under review?";
}

// Community activity, phrased honestly. Live incidents show a relative time;
// example (seeded) incidents show their static date instead of a fake "just now".
export function activityLabel(
  confirmations: number,
  lastUpdate?: string | null,
  isExample = false,
): string {
  const updated = fmtDateTime(lastUpdate);
  if (confirmations > 0) {
    if (isExample) return `Community confirmation · updated ${updated}`;
    return `Community confirmed · updated ${updated}`;
  }
  if (isExample) return `Example report · ${fmtDate(lastUpdate)}`;
  return `Last updated ${updated}`;
}
