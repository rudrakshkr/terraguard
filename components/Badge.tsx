import type { Severity } from "@/lib/types";
import { confidenceBand } from "@/lib/threat";

export function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span className={`chip chip-${severity.toLowerCase()}`}>
      <span className="dot" />
      {severity.toUpperCase()}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    Open: "chip-critical",
    Responding: "chip-warn",
    Resolved: "chip-low",
  };
  const label = status === "Open" ? "ACTIVE" : status === "Responding" ? "RESPONDING" : "RESOLVED";
  return (
    <span className={`chip ${map[status] ?? "chip-neutral"}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

export function VerificationChip({ verification }: { verification?: string }) {
  if (verification === "verified")
    return (
      <span className="chip chip-low">
        <span className="dot" />
        AI VERIFIED
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

/** Assessment-confidence band, explicitly not a calibrated probability. */
export function ConfidenceChip({
  score,
  heuristic,
  needsVerification,
  compact,
}: {
  score: number;
  heuristic?: boolean;
  needsVerification?: boolean;
  /** For fixed-width grid cells where the "Assessment confidence:" prefix is
   *  already provided by the section heading — renders just "Medium (heuristic)". */
  compact?: boolean;
}) {
  const band = confidenceBand(score);
  const cls = band === "High" ? "chip-low" : band === "Medium" ? "chip-info" : "chip-warn";
  return (
    <span
      className={`chip ${cls} !whitespace-normal`}
      title={`Raw model score ${Math.round(score * 100)}/100, interpreted as ${band}. Not a calibrated probability.`}
    >
      {!compact && <>Assessment confidence: </>}
      {band}
      {heuristic ? " (heuristic)" : ""}
      {needsVerification ? " · needs verification" : ""}
    </span>
  );
}export function FreshnessChip({
  fresh,
  minsSinceConfirmed,
}: {
  fresh: "fresh" | "recent" | "stale";
  minsSinceConfirmed: number;
}) {
  if (fresh === "fresh")
    return (
      <span className="chip chip-low">
        <span className="dot" />
        Last confirmed {minsSinceConfirmed < 1 ? "just now" : `${minsSinceConfirmed} min ago`}
      </span>
    );
  if (fresh === "recent")
    return (
      <span className="chip chip-warn">
        <span className="dot" />
        Awaiting reconfirmation
      </span>
    );
  return (
    <span className="chip chip-critical">
      <span className="dot" />
      Needs reconfirmation
    </span>
  );
}

/** Which engine produced the current output — honest about heuristic mode. */
export function ModeBadge({ aiAvailable }: { aiAvailable: boolean }) {
  return aiAvailable ? (
    <span className="chip chip-info" title="Live LLM (Gemini-compatible API) generated this assessment">
      LLM connected
    </span>
  ) : (
    <span className="chip chip-neutral" title="Running without an API key — deterministic rule-based fallback">
      Heuristic mode (no AI)
    </span>
  );
}
