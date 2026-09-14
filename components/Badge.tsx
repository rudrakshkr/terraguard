import { SEVERITY_META, STATUS_META } from "@/lib/threat";
import type { Severity } from "@/lib/types";

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY_META[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${s.bg} ${s.text} ${s.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {severity}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { text: "text-[#8ba1b7]", bg: "bg-white/5", ring: "ring-white/10" };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${m.bg} ${m.text} ${m.ring}`}
    >
      {status}
    </span>
  );
}

export function ModeBadge({ aiAvailable, grounded }: { aiAvailable: boolean; grounded?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${
        aiAvailable
          ? grounded
            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
            : "bg-sky-500/10 text-sky-300 ring-sky-500/30"
          : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${aiAvailable ? "bg-current" : "bg-current"}`} />
      {aiAvailable
        ? grounded
          ? "AI grounded in provided sources"
          : "AI analysis"
        : "Heuristic mode — no API key"}
    </span>
  );
}
