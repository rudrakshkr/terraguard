"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Download, Printer, MapPin, ShieldCheck, Clock, ThumbsUp, ThumbsDown,
  Phone, HelpCircle, ListChecks, History, Ban, Users, BookOpenCheck, X, MessageSquare,
  SendHorizontal, CheckCircle2, Layers, Trash2, Loader2,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { fmtDateTime, confidenceBand, originMeta } from "@/lib/threat";
import { fmtDistance, fmtAge, minutesSince, freshnessOf, haversineKm } from "@/lib/geo";
import { SeverityChip, StatusChip, VerificationChip, OriginChip, ConfidenceChip, FreshnessChip } from "@/components/Badge";
import SourcesPanel from "@/components/SourcesPanel";
import { Spinner } from "@/components/Spinner";
import { useAuth, authFetch } from "@/hooks/useAuth";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => <div className="flex h-[380px] items-center justify-center"><Spinner className="h-5 w-5" /></div>,
});

import { jsPDF } from "jspdf";

interface CommentItem {
  id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

function downloadPDF(i: Incident, distanceLabel: string | null) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = 0;

  doc.setFillColor(246, 247, 244);
  doc.rect(0, 0, W, 86, "F");
  doc.setTextColor(14, 116, 144);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("HillSense AI — Community Hazard Incident", M, 38);
  doc.setTextColor(90, 104, 120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("AI-verified community report for situational awareness — not an official government document.", M, 56);
  doc.text(`Generated ${new Date().toLocaleString("en-IN")}`, M, 70);
  y = 116;

  const section = (title: string) => {
    doc.setTextColor(28, 37, 48);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title.toUpperCase(), M, y);
    doc.setDrawColor(216, 221, 213);
    doc.line(M, y + 5, W - M, y + 5);
    y += 20;
  };
  const body = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(60, 70, 80);
    const lines = doc.splitTextToSize(text, W - M * 2) as string[];
    for (const line of lines) {
      if (y > 780) { doc.addPage(); y = 56; }
      doc.text(line, M, y);
      y += 14.5;
    }
    y += 6;
  };
  const bullets = (items: string[]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(60, 70, 80);
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

  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(28, 37, 48);
  doc.text(`${i.id} — ${i.incident_type} (${i.severity})`, M, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(90, 104, 120);
  doc.text(`Location: ${i.location}${i.coords_approximate ? " (approximate)" : ""}${distanceLabel ? ` · ${distanceLabel}` : ""}`, M, y); y += 14;
  doc.text(`Reported: ${fmtDateTime(i.created_at)}   |   Status: ${i.status === "Open" ? "ACTIVE" : i.status.toUpperCase()}`, M, y); y += 14;
  const band = confidenceBand(i.confidence);
  doc.text(`Verification: ${i.verification === "verified" ? "AI VERIFIED (evidence consistency)" : i.verification === "needs_review" ? "NEEDS REVIEW" : "NOT PUBLISHED"}   |   Assessment confidence: ${band}`, M, y); y += 14;
  doc.text(`Origin: ${originMeta(i.origin).label}   |   Last confirmed: ${fmtDateTime(i.last_confirmed_at ?? i.created_at)}`, M, y);
  y += 26;

  section("What happened");
  body(i.description || i.summary);
  section("What you should know");
  bullets(i.immediate_actions.length ? i.immediate_actions : ["—"]);
  if (i.avoid.length) {
    section("What to avoid");
    bullets(i.avoid);
  }
  if (i.severity_reasons?.length) {
    section(`Why ${i.severity} priority`);
    bullets(i.severity_reasons);
  }
  if (i.verification_reasons?.length) {
    section("Why this verification decision");
    bullets(i.verification_reasons);
  }
  section("Source references");
  if (i.sources.length) bullets(i.sources.map((s, n) => `[${n + 1}] ${s.title}${s.doc ? ` (knowledge-base/${s.doc}.md)` : ""}`));
  else body("None retrieved.");
  doc.setFontSize(8.5);
  doc.setTextColor(130, 140, 150);
  body("HillSense AI is a demonstration prototype. Community reports are checked by AI for evidence consistency; this is decision support, not an authoritative emergency instruction. In a life-threatening emergency call 112.");

  doc.save(`${i.id}-hillsense-incident.pdf`);
}

function useDistance(i: Incident | null) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem("hillsense-location");
        if (!raw || !i) return;
        const loc = JSON.parse(raw) as { lat: number; lng: number };
        if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return;
        const km = haversineKm(loc.lat, loc.lng, i.lat, i.lng);
        setLabel(fmtDistance(km));
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, [i]);
  return label;
}

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { user, authed, loading: authLoading } = useAuth();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [myConfirmation, setMyConfirmation] = useState<{ response: "yes" | "no"; at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const distance = useDistance(incident);

  const load = () => {
    // authFetch: signed-in users get my_confirmation back; guests get the public view.
    authFetch(`/api/incidents/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "failed");
        setIncident(data.incident as Incident);
        setComments((data.comments ?? []) as CommentItem[]);
        setMyConfirmation(data.my_confirmation ?? null);
      })
      .catch(() => setError("Could not load this incident. Check the link and try again."));
  };

  useEffect(() => {
    if (!id) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authed]);

  const confirm = async (stillPresent: boolean) => {
    setConfirming(true);
    setActionError(null);
    try {
      const res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", response: stillPresent ? "yes" : "no" }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setActionError("Please sign in to confirm hazards.");
        return;
      }
      if (!res.ok) {
        setActionError(data.error ?? "Could not record your response.");
        return;
      }
      setIncident(data.incident as Incident);
      if (data.my_confirmation) setMyConfirmation(data.my_confirmation);
      setNotice(data.message ?? (data.already_confirmed ? "You already responded to this hazard." : "Thanks — your response was recorded."));
    } catch {
      setActionError("Network problem — please try again.");
    } finally {
      setConfirming(false);
    }
  };

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setPostingComment(true);
    setActionError(null);
    try {
      const res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", body: commentText }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setActionError("Please sign in to comment.");
        return;
      }
      if (!res.ok) {
        setActionError(data.error ?? "Could not post your comment.");
        return;
      }
      setComments((c) => [data.comment as CommentItem, ...c]);
      setCommentText("");
    } catch {
      setActionError("Network problem — please try again.");
    } finally {
      setPostingComment(false);
    }
  }

  async function removeComment(commentId: string) {
    setDeletingCommentId(commentId);
    try {
      const res = await authFetch(`/api/incidents/${id}?comment_id=${commentId}`, { method: "DELETE" });
      if (res.ok) setComments((c) => c.filter((x) => x.id !== commentId));
    } finally {
      setDeletingCommentId(null);
    }
  }

  if (error) {
    return (
      <div className="container-page mx-auto max-w-2xl py-16 text-center">
        <p className="text-[14px]" style={{ color: "var(--danger)" }}>{error}</p>
        <Link href="/" className="mt-4 inline-block text-[13px] font-medium underline" style={{ color: "var(--accent)" }}>
          ← Back to nearby hazards
        </Link>
      </div>
    );
  }

  if (!incident) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  }

  const i = incident;
  const fresh = freshnessOf(i);
  const minsConfirmed = minutesSince(i.last_confirmed_at ?? i.created_at);
  const alreadyResponded = myConfirmation !== null;
  const timeline: { label: string; at: string }[] = [
    { label: `Report submitted (${originMeta(i.origin).label})`, at: i.created_at },
    ...(i.verification ? [{ label: `AI verification: ${i.verification === "verified" ? "VERIFIED" : i.verification === "needs_review" ? "NEEDS REVIEW" : "NOT PUBLISHED"}`, at: i.created_at }] : []),
    ...((i.sources?.length ?? 0) > 0 ? [{ label: `Safety sources retrieved (${i.sources.length})`, at: i.created_at }] : []),
    ...(i.pipeline?.saved_at ? [{ label: "Published / saved", at: i.pipeline.saved_at }] : []),
    ...(i.status_history ?? []).slice(1).map((h) => ({ label: `Status → ${h.status}`, at: h.at })),
  ];

  return (
    <div className="container-page mx-auto max-w-4xl py-6 sm:py-8">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] font-medium muted hover:opacity-80">
          <ArrowLeft className="h-4 w-4" /> Nearby hazards
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={() => downloadPDF(i, distance)} className="btn btn-secondary">
            <Download className="h-4 w-4" /> Download PDF
          </button>
          <button onClick={() => window.print()} className="btn btn-ghost">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      <article className="print-sheet card p-6 sm:p-8">
        {/* Header */}
        <header className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={i.severity} />
            <StatusChip status={i.status} />
            <VerificationChip verification={i.verification} />
            <OriginChip origin={i.origin} />
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">{i.incident_type}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13.5px] muted">
            <span className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" style={{ color: "var(--accent)" }} />
              {distance ?? i.location}{distance ? ` · ${i.location}` : ""}
              {i.coords_approximate ? " (approximate location)" : ""}
            </span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Reported {fmtAge(minutesSince(i.created_at))}</span>
          </p>
          <p className="mt-3 text-[15.5px] leading-relaxed">{i.summary}</p>
        </header>

        {/* Freshness + corroboration */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <FreshnessChip fresh={fresh} minsSinceConfirmed={minsConfirmed} />
          {i.confirmations_yes != null && (
            <span className="chip chip-neutral">
              {i.confirmations_yes} confirmation{i.confirmations_yes === 1 ? "" : "s"}
              {i.confirmations_no ? ` · ${i.confirmations_no} cleared` : ""}
            </span>
          )}
          {(i.related_ids?.length ?? 0) > 0 && (
            <span className="chip chip-info">
              <Layers className="h-3 w-3" />
              Corroborated by {i.related_ids?.length} related report{i.related_ids?.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {/* Community confirmation — one response per signed-in user, enforced server-side */}
        {i.status !== "Resolved" && (
          <div className="mt-5 rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            <p className="text-[14px] font-semibold">Is this hazard still present?</p>
            {authLoading ? (
              <p className="mt-2 flex items-center gap-2 text-[12.5px] muted"><Spinner className="h-3.5 w-3.5" /> Checking your session…</p>
            ) : alreadyResponded ? (
              <div className="mt-2.5 flex items-start gap-2.5 rounded-lg p-3" style={{ background: "var(--low-soft)" }}>
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0" style={{ color: "var(--low)" }} />
                <div>
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--low)" }}>
                    ✓ Thanks. Your {myConfirmation.response === "yes" ? "confirmation" : "update"} was recorded.
                  </p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--low)" }}>
                    {myConfirmation.response === "yes"
                      ? "You confirmed this hazard is still present."
                      : "You reported this hazard as cleared."}{" "}
                    ({fmtAge(minutesSince(myConfirmation.at))}) One response per person is counted.
                  </p>
                </div>
              </div>
            ) : authed ? (
              <>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => confirm(true)} disabled={confirming} className="btn btn-primary">
                    <ThumbsUp className="h-4 w-4" /> Yes, still present
                  </button>
                  <button onClick={() => confirm(false)} disabled={confirming} className="btn btn-secondary">
                    <ThumbsDown className="h-4 w-4" /> No, it has cleared
                  </button>
                  {confirming && <Spinner className="my-auto h-4 w-4" />}
                </div>
                <p className="mt-2 text-[11.5px] faint">You can respond once per incident — your answer updates how fresh this alert appears to others.</p>
              </>
            ) : (
              <div className="mt-3 rounded-lg p-3" style={{ background: "var(--surface)" }}>
                <p className="text-[12.5px] muted">
                  <Link href={`/login?next=/incident/${i.id}`} className="font-semibold underline" style={{ color: "var(--accent)" }}>Sign in with your phone</Link>{" "}
                  to confirm whether this hazard is still present. One response per person keeps the alert fresh and trustworthy.
                </p>
              </div>
            )}
            {notice && <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--low)" }}>{notice}</p>}
            {actionError && <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--danger)" }}>{actionError}</p>}
          </div>
        )}

        {/* Verification */}
        {i.verification === "rejected" ? (
          <div className="mt-5 rounded-lg p-4" style={{ background: "var(--danger-soft)" }}>
            <p className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>
              This report was not published. Its evidence did not consistently support the reported
              hazard, and it is shown here only for the reporter.
            </p>
          </div>
        ) : (
          <section className="mt-6">
            <h2 className="flex items-center gap-2 text-[15px] font-bold">
              <ShieldCheck className="h-4.5 w-4.5" style={{ color: "var(--low)" }} />
              Why was this report verified?
            </h2>
            <ul className="check-list mt-2.5 space-y-1.5">
              {(i.verification_reasons?.length ? i.verification_reasons : ["Evidence consistency checked by the HillSense pipeline"]).map((r, n) => (
                <li key={n}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] faint">
              HillSense evaluates evidence consistency — it does not judge whether a reporter is truthful.
            </p>
          </section>
        )}

        {/* Severity reasons */}
        {i.severity_reasons && i.severity_reasons.length > 0 && (
          <section className="mt-6">
            <h2 className="flex items-center gap-2 text-[15px] font-bold">
              <ListChecks className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} />
              Why {i.severity.toLowerCase()} priority?
            </h2>
            <ul className="check-list mt-2.5 space-y-1.5">
              {i.severity_reasons.map((r, n) => <li key={n}>{r}</li>)}
            </ul>
          </section>
        )}

        {/* What happened / know / avoid */}
        <section className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wider muted">What happened</h2>
            <p className="print-text mt-2 text-[13.5px] leading-relaxed">{i.description || i.summary}</p>
            {i.reporter_details && (
              <div className="mt-3 grid gap-x-4 gap-y-1 text-[12.5px] muted sm:grid-cols-2">
                {i.reporter_details.when && <span>When: {i.reporter_details.when_exact ?? i.reporter_details.when}</span>}
                {i.reporter_details.happening_now && <span>Happening now: {i.reporter_details.happening_now}</span>}
                {i.reporter_details.affected?.length ? <span>Affected: {i.reporter_details.affected.join(", ")}</span> : null}
                {i.reporter_details.casualties && <span>People affected: {i.reporter_details.casualties}</span>}
                {i.reporter_details.observed_severity && <span>Observed severity: {i.reporter_details.observed_severity}</span>}
              </div>
            )}
            {i.needs_verification && (
              <p className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                <HelpCircle className="mr-1 inline h-3.5 w-3.5" />
                {i.verification_note ?? "On-site verification recommended."}
              </p>
            )}
          </div>
          <div>
            <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider muted">
              <Users className="h-3.5 w-3.5" /> What you should know
            </h2>
            <ol className="mt-2 space-y-1.5">
              {i.immediate_actions.map((a2, n) => (
                <li key={n} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold" style={{ background: "var(--low-soft)", color: "var(--low)" }}>{n + 1}</span>
                  {a2}
                </li>
              ))}
            </ol>
            {i.avoid.length > 0 && (
              <>
                <h2 className="mt-4 flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider muted">
                  <Ban className="h-3.5 w-3.5" /> What to avoid
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {i.avoid.map((v, n) => (
                    <li key={n} className="flex gap-2 text-[13px] leading-relaxed muted">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--danger)" }} />{v}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        {/* Meta */}
        <section className="mt-6 grid grid-cols-2 gap-4 rounded-lg border p-4 text-[13px] sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Current status</div>
            <div className="mt-1"><StatusChip status={i.status} /></div>
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Last confirmed</div>
            <div className="mt-1">{fmtAge(minsConfirmed)}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Assessment confidence</div>
            <div className="mt-1"><ConfidenceChip compact score={i.confidence} heuristic={i.origin !== "ai"} needsVerification={i.needs_verification} /></div>
          </div>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Reported</div>
            <div className="mt-1">{fmtDateTime(i.created_at)}</div>
          </div>
        </section>

        {/* Map */}
        <section className="no-print mt-6">
          <h2 className="mb-2 text-[13px] font-bold uppercase tracking-wider muted">Location</h2>
          {i.coords_approximate && (
            <p className="mb-2 text-[12px]" style={{ color: "var(--warn)" }}>
              Approximate location — exact coordinates were not captured for this report.
            </p>
          )}
          <IncidentMap incidents={[i]} />
        </section>

        {/* Timeline */}
        <section className="no-print mt-6">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider muted">
            <History className="h-3.5 w-3.5" /> Timeline
          </h2>
          <ol className="relative mt-3 space-y-3 border-l pl-5" style={{ borderColor: "var(--border)" }}>
            {timeline.map((t, n) => (
              <li key={n} className="relative">
                <span className="absolute -left-[25px] h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
                <div className="text-[13px]">{t.label}</div>
                <div className="mono text-[10.5px] faint">{fmtDateTime(t.at)}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* Comments — visually distinct from the verified incident block */}
        <section className="no-print mt-8 border-t pt-6" style={{ borderColor: "var(--border)" }}>
          <h2 className="flex items-center gap-2 text-[15px] font-bold">
            <MessageSquare className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} />
            Community updates
            <span className="text-[12px] font-normal muted">({comments.length})</span>
          </h2>
          <p className="mt-1 text-[12px] muted">
            Observations from people nearby. Comments are community contributions —{" "}
            <strong>not</strong> verified facts like the AI VERIFIED assessment above.
          </p>

          {authLoading ? (
            <p className="mt-4 flex items-center gap-2 text-[12.5px] muted"><Spinner className="h-3.5 w-3.5" /> Checking your session…</p>
          ) : authed ? (
            <form onSubmit={postComment} className="mt-4">
              <textarea
                className="input min-h-[64px] resize-y"
                placeholder="Share what you saw — e.g. “The road is still blocked.” or “Traffic is being diverted.”"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={600}
                aria-label="Write a comment"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] faint">{commentText.length}/600 · posted as {user?.display_name}</span>
                <button type="submit" disabled={postingComment || !commentText.trim()} className="btn btn-primary !py-1.5">
                  {postingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
                  Post update
                </button>
              </div>
            </form>
          ) : (
            <p className="mt-4 rounded-lg p-3 text-[12.5px] muted" style={{ background: "var(--surface-2)" }}>
              <Link href={`/login?next=/incident/${i.id}`} className="font-semibold underline" style={{ color: "var(--accent)" }}>Sign in</Link>{" "}
              to post a community update.
            </p>
          )}

          <ul className="mt-5 space-y-3">
            {comments.length === 0 ? (
              <li className="text-[12.5px] faint">No community updates yet.</li>
            ) : (
              comments.map((c) => (
                <li key={c.id} className="rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10.5px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                      {c.author_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                    </span>
                    <span className="text-[13px] font-semibold">{c.author_name.split(/\s+/)[0]}</span>
                    <span className="text-[11px] faint">{fmtAge(minutesSince(c.created_at))}</span>
                    {user && c.user_id === user.id && (
                      <button
                        type="button"
                        onClick={() => removeComment(c.id)}
                        disabled={deletingCommentId === c.id}
                        className="ml-auto flex items-center gap-1 text-[11px] font-medium"
                        style={{ color: "var(--danger)" }}
                        aria-label="Delete your comment"
                      >
                        {deletingCommentId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{c.body}</p>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* Sources */}
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider muted">
            <BookOpenCheck className="h-3.5 w-3.5" /> Safety sources used
          </h2>
          <div className="mt-3">
            <SourcesPanel sources={i.sources.map((s, n) => ({ id: `${i.id}-${n}`, title: s.title, doc: s.doc ?? "", excerpt: "", score: 0 }))} />
          </div>
        </section>

        <footer className="mt-8 flex items-start gap-3 rounded-lg p-4" style={{ background: "var(--danger-soft)" }}>
          <Phone className="mt-0.5 h-4.5 w-4.5 shrink-0" style={{ color: "var(--danger)" }} />
          <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--danger)" }}>
            <strong>For life-threatening emergencies, call 112.</strong> HillSense is a community
            awareness tool: reports are checked by AI for evidence consistency, but it is not an
            official alert channel — always follow your district administration&apos;s instructions.
            {i.origin === "seed" && " This incident is seeded demonstration data."}
          </p>
        </footer>
      </article>
    </div>
  );
}
