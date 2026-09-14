"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ScrollText, ArrowLeft, Download, Printer, MapPin, AlertTriangle, Ban,
  Users, BookOpenCheck, ShieldAlert,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { fmtDateTime } from "@/lib/threat";
import { SeverityBadge, StatusBadge } from "@/components/Badge";
import { Spinner } from "@/components/Spinner";

// Leaflet needs the browser — load the map client-side only.
const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-lg border border-[#223041] text-[#4d6275]">
      <Spinner className="h-5 w-5" />
    </div>
  ),
});
import { jsPDF } from "jspdf";

function downloadPDF(i: Incident) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = 0;

  // Header band
  doc.setFillColor(11, 15, 20);
  doc.rect(0, 0, W, 86, "F");
  doc.setTextColor(56, 189, 248);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("HillSense AI — Incident Report", M, 38);
  doc.setTextColor(139, 161, 183);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("AI-generated decision support — not an official government document.", M, 56);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 70);
  y = 116;

  const section = (title: string) => {
    doc.setTextColor(11, 15, 20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), M, y);
    doc.setDrawColor(34, 48, 65);
    doc.line(M, y + 5, W - M, y + 5);
    y += 20;
  };
  const body = (text: string, size = 10.5) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    doc.setTextColor(40, 50, 60);
    const lines = doc.splitTextToSize(text, W - M * 2) as string[];
    for (const line of lines) {
      if (y > 780) { doc.addPage(); y = 56; }
      doc.text(line, M, y);
      y += size + 4;
    }
    y += 6;
  };
  const bullets = (items: string[]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(40, 50, 60);
    for (const item of items) {
      const lines = doc.splitTextToSize(item, W - M * 2 - 14) as string[];
      if (y > 780) { doc.addPage(); y = 56; }
      doc.text("•", M, y);
      lines.forEach((line) => {
        if (y > 780) { doc.addPage(); y = 56; }
        doc.text(line, M + 14, y);
        y += 14.5;
      });
    }
    y += 6;
  };

  // Meta
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(11, 15, 20);
  doc.text(`${i.id} — ${i.incident_type} (${i.severity})`, M, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(80, 90, 100);
  doc.text(`Location: ${i.location}   |   Date/Time: ${fmtDateTime(i.created_at)}   |   Status: ${i.status}`, M, y);
  y += 14;
  doc.text(`AI confidence: ${Math.round(i.confidence * 100)}%   |   Urgent attention: ${i.requires_urgent_attention ? "YES" : "no"}`, M, y);
  y += 26;

  section("Description");
  body(i.description || i.summary);
  section("AI Summary");
  body(i.summary);
  section("Detected Risk Factors");
  bullets(i.risk_factors.length ? i.risk_factors : ["—"]);
  section("Immediate Actions");
  bullets(i.immediate_actions.length ? i.immediate_actions : ["—"]);
  section("Things to Avoid");
  bullets(i.avoid.length ? i.avoid : ["—"]);
  section("Recommended Response");
  body(i.recommended_response || "—");
  section("Source References (RAG)");
  if (i.sources.length) bullets(i.sources.map((s, n) => `[${n + 1}] ${s.title}`));
  else body("No knowledge-base passages were retrieved for this incident.");
  y += 8;
  doc.setFontSize(8.5);
  doc.setTextColor(130, 140, 150);
  body("HillSense AI is a demonstration prototype. This report is decision support, not an authoritative emergency instruction. In a life-threatening emergency call 112.", 8.5);

  doc.save(`${i.id}-hillsense-report.pdf`);
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/incidents/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "failed");
        setIncident(data.incident as Incident);
      })
      .catch(() => setError("Could not load this incident. Check the ID and try again."));
  }, [id]);

  if (error) {
    return (
      <div className="topo min-h-screen">
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <p className="text-[14px] text-red-300">{error}</p>
          <Link href="/dashboard" className="mt-4 inline-block text-[13px] font-medium text-sky-400 hover:underline">
            ← Back to Command Center
          </Link>
        </div>
      </div>
    );
  }

  if (!incident) {
    return (
      <div className="topo flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-sky-400" />
      </div>
    );
  }

  const i = incident;
  const backHref = i.origin === "seed" ? "/dashboard" : "/report";

  return (
    <div className="topo min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Action bar */}
        <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href={backHref} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#8ba1b7] hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadPDF(i)}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-[13px] font-semibold text-[#06232f] hover:bg-sky-400"
            >
              <Download className="h-4 w-4" /> Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#2c3e54] px-4 py-2 text-[13px] font-medium text-[#c6d4e0] hover:border-sky-500/50"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
          </div>
        </div>

        {/* Report sheet */}
        <article className="print-sheet panel p-6 sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[#223041] pb-5">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/40">
                  <ScrollText className="h-4.5 w-4.5 text-sky-400" />
                </span>
                <div>
                  <h1 className="text-xl font-bold tracking-tight">Incident Report</h1>
                  <div className="font-mono text-[12px] text-sky-300">{i.id}</div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={i.severity} />
              <StatusBadge status={i.status} />
              {i.requires_urgent_attention && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-0.5 text-[11px] font-bold text-red-300 ring-1 ring-red-500/40">
                  <ShieldAlert className="h-3 w-3" /> URGENT
                </span>
              )}
            </div>
          </header>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-[#223041] py-5 text-[13px] sm:grid-cols-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d6275]">Location</div>
              <div className="mt-0.5 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-sky-400" />{i.location}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d6275]">Type</div>
              <div className="mt-0.5">{i.incident_type}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d6275]">Date / time</div>
              <div className="mt-0.5">{fmtDateTime(i.created_at)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#4d6275]">AI confidence</div>
              <div className="mt-0.5 font-mono">{Math.round(i.confidence * 100)}%</div>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-6 py-6">
            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#4d6275]">Description</h2>
              <p className="print-text text-[13.5px] leading-relaxed text-[#e6edf3]">{i.description || i.summary}</p>
            </section>

            <section>
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#4d6275]">AI summary</h2>
              <p className="print-text text-[13.5px] leading-relaxed text-[#e6edf3]">{i.summary}</p>
            </section>

            {i.risk_factors.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> Detected risk factors
                </h2>
                <ul className="space-y-1.5">
                  {i.risk_factors.map((r, n) => (
                    <li key={n} className="print-text flex gap-2 text-[13px] text-[#c6d4e0]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />{r}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  <Users className="h-3.5 w-3.5" /> Immediate actions
                </h2>
                <ol className="space-y-1.5">
                  {i.immediate_actions.map((a2, n) => (
                    <li key={n} className="print-text flex gap-2.5 text-[13px] leading-relaxed text-[#e6edf3]">
                      <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-emerald-500/15 text-[10px] font-bold text-emerald-300">{n + 1}</span>
                      {a2}
                    </li>
                  ))}
                </ol>
              </section>
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-red-300">
                  <Ban className="h-3.5 w-3.5" /> Things to avoid
                </h2>
                <ul className="space-y-1.5">
                  {i.avoid.map((v, n) => (
                    <li key={n} className="print-text flex gap-2 text-[13px] leading-relaxed text-[#c6d4e0]">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-red-400" />{v}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {i.recommended_response && (
              <section>
                <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-sky-300">Recommended response</h2>
                <p className="print-text rounded-lg border border-[#223041] bg-[#0d1218] p-3.5 text-[13px] leading-relaxed text-[#c6d4e0]">
                  {i.recommended_response}
                </p>
              </section>
            )}

            {/* Map */}
            <section className="no-print">
              <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[#4d6275]">Location on map</h2>
              <IncidentMap incidents={[i]} />
            </section>

            {/* Sources */}
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#4d6275]">
                <BookOpenCheck className="h-3.5 w-3.5" /> Source references (RAG)
              </h2>
              {i.sources.length ? (
                <ol className="list-inside list-decimal space-y-1 text-[13px] text-[#c6d4e0]">
                  {i.sources.map((s, n) => (
                    <li key={n} className="print-text">{s.title}{s.doc ? <span className="font-mono text-[11px] text-[#4d6275]"> · knowledge-base/{s.doc}.md</span> : null}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] text-[#8ba1b7]">No knowledge-base passages were retrieved for this incident.</p>
              )}
            </section>
          </div>

          <footer className="border-t border-[#223041] pt-4 text-[11px] leading-relaxed text-[#4d6275]">
            Generated by HillSense AI — a demonstration prototype. This report is decision support,
            not an authoritative emergency instruction. In a life-threatening emergency call 112.
            {i.origin === "seed" && " This incident is seeded demonstration data."}
          </footer>
        </article>
      </div>
    </div>
  );
}
