"use client";

import { useRef, useState } from "react";
import { SendHorizontal, RotateCcw, BookOpenCheck, AlertTriangle, Phone } from "lucide-react";
import type { RagAnswer, RagSource } from "@/lib/types";
import SourcesPanel from "@/components/SourcesPanel";
import { Spinner } from "@/components/Spinner";

interface Turn {
  q: string;
  a: RagAnswer | null;
  error?: string;
}

const SUGGESTIONS = [
  "What should I do if a landslide blocks the road?",
  "What are the warning signs of a possible landslide?",
  "What should tourists do during a flash flood?",
  "What should we do if rocks start falling near a road?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastSources, setLastSources] = useState<RagSource[]>([]);
  const [lastGrounded, setLastGrounded] = useState<boolean | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = async (q: string) => {
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setQuestion("");
    setTurns((t) => [...t, { q: query, a: null }]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTurns((t) => [...t.slice(0, -1), { q: query, a: null, error: typeof data.error === "string" ? data.error : "Ask failed. Please try again." }]);
      } else {
        const answer = data as RagAnswer;
        setTurns((t) => [...t.slice(0, -1), { q: query, a: answer }]);
        setLastSources(answer.sources);
        setLastGrounded(answer.aiAvailable);
      }
    } catch {
      setTurns((t) => [...t.slice(0, -1), { q: query, a: null, error: "Could not reach the Ask service. Check your connection." }]);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  };

  return (
    <div className="container-page mx-auto max-w-4xl py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-[22px] font-bold tracking-tight sm:text-2xl">Ask HillSense</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed muted">
          Mountain-safety questions answered from the HillSense knowledge base — every answer shows
          the sources it was grounded in.
        </p>
      </div>

      {turns.length === 0 && (
        <div className="mb-6 grid gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => ask(s)}
              className="card p-3.5 text-left text-[13px] transition hover:border-[var(--accent)]"
            >
              “{s}”
            </button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {turns.map((t, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end">
              <div
                className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[13.5px]"
                style={{ background: "var(--accent-soft)", color: "var(--text)" }}
              >
                {t.q}
              </div>
            </div>
            {t.error ? (
              <div className="card flex items-start gap-2 p-4 text-[13px]" style={{ color: "var(--danger)" }}>
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t.error}
              </div>
            ) : t.a ? (
              <div className="card fade-up p-4">
                <div className="mb-2 flex items-center gap-2">
                  <BookOpenCheck className="h-4 w-4" style={{ color: "var(--low)" }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--low)" }}>
                    {t.a.aiAvailable ? "Grounded answer" : "Knowledge-base passages"}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{t.a.answer}</p>
              </div>
            ) : (
              <div className="card flex items-center gap-2.5 p-4 text-[13px] muted">
                <Spinner /> Retrieving knowledge and composing an answer…
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {turns.length > 0 && lastSources.length > 0 && (
        <div className="mt-6">
          <SourcesPanel sources={lastSources} grounded={lastGrounded} />
        </div>
      )}

      <div className="sticky bottom-4 mt-6">
        <form
          onSubmit={(e) => { e.preventDefault(); ask(question); }}
          className="card flex items-center gap-2 p-2 shadow-lg"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about landslide signs, flash floods, evacuation…"
            className="flex-1 bg-transparent px-3 py-2 text-[13.5px] focus:outline-none"
            style={{ color: "var(--text)" }}
            aria-label="Your question"
          />
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => { setTurns([]); setLastSources([]); setLastGrounded(undefined); }}
              title="Clear conversation"
              aria-label="Clear conversation"
              className="btn btn-ghost !px-2"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button type="submit" disabled={busy || !question.trim()} className="btn btn-primary">
            {busy ? <Spinner className="h-3.5 w-3.5" /> : <SendHorizontal className="h-4 w-4" />}
            Ask
          </button>
        </form>
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] faint">
          <Phone className="h-3 w-3" /> Decision support only — in a life-threatening emergency call 112.
        </p>
      </div>
    </div>
  );
}
