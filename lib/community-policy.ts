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

import type { Incident } from "./types";

/** Independent first-hand confirmations required to publish a review-only report. */
export const PUBLICATION_THRESHOLD = 2;

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
        "You cannot confirm your own report. This hazard needs an independent first-hand observation.",
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

/** How many more independent confirmations a review-only report still needs. */
export function corroborationRemaining(yesCount: number): number {
  return Math.max(0, PUBLICATION_THRESHOLD - Math.max(0, yesCount));
}

/**
 * Should a review-only report be published because enough independent
 * community members corroborated it?
 */
export function shouldPublishFromCorroboration(
  incident: Pick<Incident, "publication" | "verification" | "origin">,
  independentYesCount: number,
): boolean {
  return (
    isReviewOnly(incident) &&
    incident.origin !== "seed" &&
    independentYesCount >= PUBLICATION_THRESHOLD
  );
}

/**
 * Progress line shown next to a review card, e.g. "1 of 2 confirmations".
 */
export function corroborationProgressLabel(yesCount: number): string {
  const yes = Math.max(0, yesCount);
  return `${Math.min(yes, PUBLICATION_THRESHOLD)} of ${PUBLICATION_THRESHOLD} confirmations`;
}
