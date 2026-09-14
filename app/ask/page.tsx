"use client";

import { useRef, useState } from "react";
import {
  MessageCircleQuestion, SendHorizontal, RotateCcw, BookOpenCheck, AlertTriangle,
} from "lucide-react";
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
        setTurns((t) => [
          ...t.slice(0, -1),
          { q: query, a: null, error: typeof data.error === "string" ? data.error : "Ask failed. Please try again." },
        ]);
      } else {
        const answer = data as RagAnswer;
        setTurns((t) => [...t.slice(0, -1), { q: query, a: answer }]);
        setLastSources(answer.sources);
        setLastGrounded(answer.aiAvailable);
      }
    } catch {
      setTurns((t) => [
        ...t.slice(0, -1),
        { q: query, a: null, error: "Could not reach the Ask service. Check your connection." },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  };

  return (
    <div className="topo min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/40">
              <MessageCircleQuestion className="h-4.5 w-4.5 text-sky-400" />
            </span>
            Ask HillSense
          </h1>
          <p className="mt-2 text-[13.5px] text-[#8ba1b7]">
            Disaster-safety questions answered from the HillSense knowledge base — every answer
            shows the sources it was grounded in.
          </p>
        </div>

        {/* Suggested questions */}
        {turns.length === 0 && (
          <div className="mb-6 grid gap-2.5 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="panel-hover rounded-lg border border-[#223041] bg-[#0d1218] p-3.5 text-left text-[13px] text-[#c6d4e0]"
              >
                “{s}”
              </button>
            ))}
          </div>
        )}

        {/* Conversation */}
        <div className="space-y-4">
          {turns.map((t, i) => (
            <div key={i} className="space-y-3">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-sky-500/15 px-4 py-2.5 text-[13.5px] text-[#e6edf3] ring-1 ring-sky-500/30">
                  {t.q}
                </div>
              </div>
              {t.error ? (
                <div className="panel flex items-start gap-2 p-4 text-[13px] text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t.error}
                </div>
              ) : t.a ? (
                <div className="panel fade-up p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpenCheck className="h-4 w-4 text-emerald-400" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                      {t.a.aiAvailable ? "Grounded answer" : "Knowledge-base passages"}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#e6edf3]">
                    {t.a.answer}
                  </p>
                </div>
              ) : (
                <div className="panel flex items-center gap-2.5 p-4 text-[13px] text-[#8ba1b7]">
                  <Spinner /> Retrieving knowledge and composing an answer…
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Sources for the latest answer */}
        {turns.length > 0 && lastSources.length > 0 && (
          <div className="mt-6">
            <SourcesPanel sources={lastSources} grounded={lastGrounded} />
          </div>
        )}

        {/* Input */}
        <div className="sticky bottom-4 mt-6">
          <form
            onSubmit={(e) => { e.preventDefault(); ask(question); }}
            className="panel flex items-center gap-2 p-2 shadow-lg shadow-black/40"
          >
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about landslide signs, flash floods, evacuation…"
              className="flex-1 bg-transparent px-3 py-2 text-[13.5px] text-[#e6edf3] placeholder:text-[#4d6275] focus:outline-none"
            />
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => { setTurns([]); setLastSources([]); setLastGrounded(undefined); }}
                title="Clear conversation"
                className="rounded-lg p-2 text-[#8ba1b7] hover:bg-[#1c2836] hover:text-white"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-[13px] font-semibold text-[#06232f] hover:bg-sky-400 disabled:opacity-40"
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <SendHorizontal className="h-4 w-4" />}
              Ask
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] text-[#4d6275]">
            Decision support only — in a life-threatening emergency call 112.
          </p>
        </div>
      </div>
    </div>
  );
}
