import type { Severity } from "@/lib/types";
import { fmtDateTime, activityLabel } from "@/lib/labels";

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`chip chip-${severity.toLowerCase()}`}>
      <span className="dot" />
      {severity.toUpperCase()}
    </span>
  );
}

/**
 * Operational status. "Active" means the hazard is being observed by the
 * community — it deliberately does not claim that responders are deployed.
 */
export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: "chip-critical",
    Active: "chip-critical",
    Responding: "chip-warn",
    Resolved: "chip-low",
  };
  const label =
    status === "Resolved" ? "RESOLVED" : status === "Responding" ? "ACTIVE" : "ACTIVE";
  return (
    <span className={`chip ${map[status] ?? "chip-critical"}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

/**
 * Evidence check outcome shown on reports that passed the automated checks.
 * The accompanying line is rendered next to this chip on each page.
 */
export function VerificationChip({ verification }: { verification?: string }) {
  if (verification === "verified")
    return (
      <span className="chip chip-low">
        <span className="dot" />
        AI CHECK PASSED
      </span>
    );
  if (verification === "needs_review")
    return (
      <span className="chip chip-warn">
        <span className="dot" />
        NEEDS REVIEW
      </span>
    );
  if (verification === "rejected")
    return (
      <span className="chip chip-critical">
        <span className="dot" />
        NOT PUBLISHED
      </span>
    );
  return null;
}

/** One-line, plain-words explanation of what the AI check did and did not do. */
export function VerificationNote() {
  return (
    <p className="text-[11.5px] muted leading-relaxed">
      AI checks whether the available report evidence is consistent. It does not determine whether
      a person is truthful.
    </p>
  );
}

/** Provenance chips for the demo dataset vs new community reports. */
export function OriginChip({ origin }: { origin: string }) {
  if (origin === "seed")
    return (
      <span className="chip chip-neutral" title="Seeded demonstration data — not a live report">
        DEMO DATA
      </span>
    );
  if (origin === "ai")
    return (
      <span className="chip chip-info" title="Submitted by a community member through HillSense">
        NEW COMMUNITY REPORT
      </span>
    );
  return null;
}

/**
 * Evidence assessment. Shown as a consistent statement (e.g. "Consistent")
 * — never as an uncalibrated confidence score.
 */
export function EvidenceChip({ assessment }: { assessment: string }) {
  const cls =
    assessment === "Consistent" ? "chip-low" : assessment === "Unclear" ? "chip-warn" : "chip-critical";
  return (
    <span className={`chip ${cls} !whitespace-normal`}>
      Evidence assessment: {assessment}
    </span>
  );
}

/**
 * Freshness of a live incident. Shows "Last updated" unless community
 * confirmations exist, in which case the confirmation count is shown.
 */
export function FreshnessChip({
  fresh,
  minsSinceConfirmed,
  confirmations = 0,
}: {
  fresh: "fresh" | "recent" | "stale";
  minsSinceConfirmed: number;
  confirmations?: number;
}) {
  if (confirmations > 0)
    return (
      <span className="chip chip-info">
        <span className="dot" />
        Community confirmation · {confirmations} {confirmations === 1 ? "person" : "people"}
      </span>
    );
  if (fresh === "fresh")
    return (
      <span className="chip chip-low">
        <span className="dot" />
        Last updated {minsSinceConfirmed < 1 ? "just now" : `${minsSinceConfirmed} min ago`}
      </span>
    );
}

/**
 * Community activity line. Shows "Last updated" for reports with no community
 * confirmations, and mentions the confirmation count only when someone has
 * actually confirmed the incident.
 */
export function ActivityChip({
  confirmations,
  lastUpdate,
  isExample = false,
}: {
  confirmations: number;
  lastUpdate?: string | null;
  isExample?: boolean;
}) {
  const cls = confirmations > 0 ? "chip-info" : "chip-neutral";
  return (
    <span className={`chip ${cls}`} title={`Last update: ${fmtDateTime(lastUpdate) || "—"}`}>
      <span className="dot" />
      {activityLabel(confirmations, lastUpdate, isExample)}
    </span>
  );
}

/**
 * Which AI services are available right now — phrased for non-technical
 * readers, without naming engines, models or infrastructure.
 */
export function ModeBadge({ aiAvailable }: { aiAvailable: boolean }) {
  return aiAvailable ? (
    <span className="chip chip-info" title="Automated report checks and safety guidance are available">
      AI services available
    </span>
  ) : (
    <span className="chip chip-neutral" title="Automated checks are running in reduced mode">
      AI services limited
    </span>
  );
}
