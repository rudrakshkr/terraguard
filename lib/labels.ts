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
