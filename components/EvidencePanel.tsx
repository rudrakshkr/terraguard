"use client";

import { useState } from "react";
import { ChevronDown, BookOpenCheck, Link2 } from "lucide-react";
import type { AnalyzeResponse } from "@/lib/types";

/**
 * "Why this recommendation?" — pairs each key recommendation with the
 * retrieved knowledge passages whose wording supports it. Expandable so
 * judges can inspect the exact grounding evidence, including scores.
 */
export default function EvidencePanel({ result }: { result: AnalyzeResponse }) {
  const [open, setOpen] = useState(false);
  const links = result.evidence ?? [];

  if (links.length === 0) {
    return (
      <div className="card p-4 text-[13px] muted">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <BookOpenCheck className="h-4 w-4" style={{ color: "var(--low)" }} />
          Why this recommendation?
        </div>
        No direct passage-level match was found for these recommendations — they follow the
        incident playbook and the retrieved sources shown below.
      </div>
    );
  }

  return (
    <div className="card p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <div className="flex flex-wrap items-center gap-2">
          <BookOpenCheck className="h-4 w-4" style={{ color: "var(--low)" }} />
          <h3 className="text-[13.5px] font-semibold">Why this recommendation?</h3>
          <span className="chip chip-low">
            {links.length} recommendation{links.length > 1 ? "s" : ""} tied to sources
          </span>
        </div>
        <span className="flex items-center gap-1 text-[11.5px] font-medium muted">
          {open ? "Hide evidence" : "View evidence"}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <ul className="mt-3 space-y-3">
          {links.map((l, i) => (
            <li key={i} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <div className="flex items-start gap-2">
                <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent)" }} />
                <p className="text-[13px] font-medium leading-relaxed">{l.claim}</p>
              </div>
              <div className="mt-2 space-y-1.5 pl-5">
                {l.refs.map((r) => {
                  const s = result.sources[r];
                  if (!s) return null;
                  return (
                    <div key={r} className="rounded-md border p-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px]">
                        <span className="font-semibold" style={{ color: "var(--accent)" }}>[{r + 1}] {s.title}</span>
                        <span className="mono text-[10px] faint">{s.doc}</span>
                        {s.organization && <span className="text-[10.5px] muted">· {s.organization}</span>}
                      </div>
                      <p className="mt-1 text-[12px] leading-relaxed muted">
                        {s.excerpt.slice(0, 220)}
                        {s.excerpt.length > 220 ? "…" : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
