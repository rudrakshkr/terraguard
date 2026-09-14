import { BookOpenCheck, FileText } from "lucide-react";
import type { RagSource } from "@/lib/types";

export default function SourcesPanel({
  sources,
  grounded,
}: {
  sources: RagSource[];
  grounded?: boolean;
}) {
  if (sources.length === 0) {
    return (
      <div className="card p-4 text-sm muted">No knowledge-base passages matched this report.</div>
    );
  }
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4" style={{ color: "var(--low)" }} />
          <h3 className="text-[13.5px] font-semibold">Sources used</h3>
        </div>
        {grounded ? (
          <span className="chip chip-low">
            <span className="dot" />
            AI grounded in provided sources
          </span>
        ) : (
          <span className="chip chip-info">RAG retrieval</span>
        )}
      </div>
      <ul className="space-y-2.5">
        {sources.map((s, i) => (
          <li key={s.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 muted" />
                  <span className="text-[13px] font-semibold">{s.title}</span>
                  {s.organization && <span className="chip chip-neutral">{s.organization}</span>}
                </div>
                <div className="mono mt-0.5 text-[10px] faint">
                  knowledge-base/{s.doc}.md · similarity {s.score.toFixed(2)}
                </div>
                {s.material && (
                  <div className="mt-1 text-[10.5px] italic muted">{s.material}</div>
                )}
                <p className="mt-2 text-[13px] leading-relaxed muted">{s.excerpt}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
