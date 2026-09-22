/**
 * Community corroboration policy — the single source of truth for who may
 * confirm a hazard and when an AI "needs review" report becomes public.
 *
 * The rule that gives community confirmation its meaning: an incident can only
 * be corroborated by people OTHER than the person who reported it. The
 * reporter's own response is refused at the API boundary, and is also excluded
 * from the aggregate counts as defence in depth (so legacy records that
 * predate this rule can never inflate corroboration).
 *
 * Published reports remain independent of this: it governs corroboration of
 * review-only reports, not whether the reporter can keep using their account.
 */

import type { Incident } from "./types";/** Independent first-hand observations required to publish a review-only report. */
export const PUBLICATION_THRESHOLD = 3;
export interface ConfirmDecisionAllowed {
  allowed: true;
}
export interface ConfirmDecisionRejected {
  allowed: false;
  status: number; // HTTP status the API must return
  code: "sign_in_required" | "own_report";
  reason: string; // user-facing explanation
}
export type ConfirmDecision = ConfirmDecisionAllowed | ConfirmDecisionRejected;

/**
 * May this user record a community confirmation ("still present" / "cleared")
 * for this incident?
 *
 * Server-side gate — never rely on hiding the buttons in the UI. Callers must
 * pass the authenticated user id; a missing id is a signed-out request.
 */
export function canConfirmHazard(
  incident: Pick<Incident, "reporter_id">,
  userId: string | undefined | null,
): ConfirmDecision {
  if (!userId) {
    return {
      allowed: false,
      status: 401,
      code: "sign_in_required",
      reason: "Please sign in with your phone number to respond to hazards.",
    };
  }
  if (incident.reporter_id && incident.reporter_id === userId) {
    return {
      allowed: false,
      status: 403,
      code: "own_report",
      reason:
        "This report is awaiting independent community confirmation. You cannot confirm your own report.",
    };
  }
  return { allowed: true };
}

/** True for reports saved but not yet corroborated (private to signed-in members). */
export function isReviewOnly(
  incident: Pick<Incident, "publication" | "verification">,
): boolean {
  return incident.publication === "review_only" && incident.verification === "needs_review";
}

/** How many more independent observations a review-only report still needs. */
export function corroborationRemaining(yesCount: number): number {
  return Math.max(0, PUBLICATION_THRESHOLD - Math.max(0, yesCount));
}

/**
 * Should a review-only report be published because enough independent
 * community members corroborated it?
 */
export function shouldPublishFromCorroboration(
  incident: Pick<Incident, "publication" | "verification" | "origin" | "evidence_contradiction">,
  independentYesCount: number,
): boolean {
  return (
    isReviewOnly(incident) &&
    incident.origin !== "seed" &&
    // A count is a minimum, never a truth score: observations cannot publish a
    // report whose submitted evidence still contradicts itself.
    incident.evidence_contradiction !== true &&
    independentYesCount >= PUBLICATION_THRESHOLD
  );
}

/**
 * Explain the publication gate in plain language (surfaced to the UI and the
 * Command Center so an operator can see WHY a report is or is not public).
 */
export function corroborationStateLabel(
  incident: Pick<Incident, "publication" | "verification" | "evidence_contradiction">,
  independentYesCount: number,
  clearedCount = 0,
): string {
  if (!isReviewOnly(incident)) return "Not in review";
  const yes = Math.max(0, independentYesCount);
  if (incident.evidence_contradiction === true && yes >= PUBLICATION_THRESHOLD) {
    return "Community observations are present, but the submitted evidence still needs review.";
  }
  if (clearedCount > 0) {
    return `${yes} independent observation${yes === 1 ? "" : "s"} and ${clearedCount} cleared response${clearedCount === 1 ? "" : "s"} — additional corroboration needed.`;
  }
  if (yes === 0) return "Awaiting independent community observations.";
  if (yes >= PUBLICATION_THRESHOLD) return "Eligible for publication from community corroboration.";
  return `${yes} independent observation${yes === 1 ? "" : "s"} received — additional corroboration needed.`;
}

/**
 * Progress line shown next to a review card, e.g. "1 of 3 observations".
 */
export function corroborationProgressLabel(yesCount: number): string {
  const yes = Math.max(0, yesCount);
  return `${Math.min(yes, PUBLICATION_THRESHOLD)} of ${PUBLICATION_THRESHOLD} observations`;
}
