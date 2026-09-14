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
      <div className="panel p-4 text-sm text-[#8ba1b7]">
        No knowledge-base passages matched this report.
      </div>
    );
  }
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold">Retrieved sources</h3>
        </div>
        {grounded ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            AI grounded in provided sources
          </span>
        ) : (
          <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 ring-1 ring-sky-500/30">
            RAG retrieval
          </span>
        )}
      </div>
      <ul className="space-y-2.5">
        {sources.map((s, i) => (
          <li key={s.id} className="rounded-lg border border-[#223041] bg-[#0d1218] p-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-[11px] font-bold text-sky-300">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[#8ba1b7]" />
                  <span className="text-[13px] font-semibold">{s.title}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-[#8ba1b7]">
                  knowledge-base/{s.doc}.md · score {s.score.toFixed(2)}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-[#aebecb]">{s.excerpt}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
