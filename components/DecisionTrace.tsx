"use client";

import { CheckCircle2, Loader2, Circle } from "lucide-react";
import type { VerificationResult } from "@/lib/verification";

const STEPS = [
  "Report received",
  "Image analyzed",
  "Description checked",
  "Hazard consistency checked",
  "Location checked",
  "Related incidents checked",
];

/**
 * System-level verification trace shown to the reporter. Only observable
 * checks appear here — no hidden chain-of-thought, no "lie detection".
 */
export default function DecisionTrace({
  active,
  verification,
}: {
  active: boolean;
  verification: VerificationResult | null;
}) {
  if (!active && !verification) return null;

  const done = !active && verification !== null;
  const checkForStep = (step: string): "pass" | "warn" | "fail" | "skip" | "pending" | "active" => {
    if (!verification) return active ? "active" : "pending";
    const match = verification.evidence_checks.find((c) =>
      c.check.toLowerCase().startsWith(step.toLowerCase().split(" ")[0]),
    );
    return match?.pass ?? "skip";
  };

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Verifying report</h3>
        {done ? (
          <span className="text-[11.5px] font-semibold" style={{ color: "var(--low)" }}>complete</span>
        ) : (
          <span className="text-[11.5px] font-medium" style={{ color: "var(--accent)" }}>analyzing…</span>
        )}
      </div>
      <ol className="space-y-2">
        {STEPS.map((s) => {
          const state = checkForStep(s);
          return (
            <li key={s} className="flex items-center gap-2.5 text-[13px]">
              {state === "pass" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--low)" }} />
              ) : state === "fail" ? (
                <Circle className="h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} />
              ) : state === "warn" ? (
                <Circle className="h-4 w-4 shrink-0" style={{ color: "var(--warn)" }} />
              ) : state === "active" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: "var(--accent)" }} />
              ) : state === "skip" || state === "pending" ? (
                <Circle className="h-4 w-4 shrink-0" style={{ color: "var(--border)" }} />
              ) : (
                <Circle className="h-4 w-4 shrink-0" style={{ color: "var(--border)" }} />
              )}
              <span style={{ color: state === "pending" ? "var(--text-3)" : "var(--text)" }}>{s}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 border-t pt-2.5 text-[10.5px] muted" style={{ borderColor: "var(--border)" }}>
        System-level evidence checks only — model internals are not exposed.
      </p>
    </div>
  );
}
