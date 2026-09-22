"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Download, Printer, MapPin, ShieldCheck, Clock3, ThumbsUp, ThumbsDown,
  Phone, Ban, UsersRound, X, MessageSquare,
  SendHorizontal, CheckCircle2, Layers, Trash2, Loader2, MoreHorizontal, RefreshCw, WifiOff,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { fmtDateTime, originMeta } from "@/lib/threat";
import { fmtDistance, fmtAge, minutesSince, haversineKm } from "@/lib/geo";
import { SeverityChip, StatusChip, VerificationChip, OriginChip, EvidenceChip } from "@/components/Badge";
import {
  aiInterpretationOf, exampleReportLabel, fmtDate, publicationEventLabel,
  reportTitle, reviewSectionTitle,
} from "@/lib/labels";
import { corroborationProgressLabel, isReviewOnly } from "@/lib/community-policy";
import { Disclosure } from "@/components/Disclosure";
import SourcesPanel from "@/components/SourcesPanel";
import { Spinner } from "@/components/Spinner";
import { useAuth, authFetch, getAuthToken } from "@/hooks/useAuth";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => <div className="flex h-[300px] items-center justify-center sm:h-[380px]"><Spinner className="h-5 w-5" /></div>,
});

import { jsPDF } from "jspdf";

interface CommentItem {
  id: string;
  user_id: string;
  author_name: string;
  author_display_name?: string;
  author_initials?: string;
  author_avatar_url?: string | null;
  body: string;
  created_at: string;
  /** Set for not-yet-synchronized comments created offline. */
  local_state?: "pending";
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
  doc.text("AI-checked community report for situational awareness — not an official government document.", M, 56);
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
  doc.text(`${i.id} — ${reportTitle(i)} (${i.severity})`, M, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(90, 104, 120);
  doc.text(`Location: ${i.location}${i.coords_approximate ? " (approximate)" : ""}${distanceLabel ? ` · ${distanceLabel}` : ""}`, M, y); y += 14;
  doc.text(`Reported: ${i.origin === "seed" ? fmtDate(i.created_at) : fmtDateTime(i.created_at)}   |   Status: ${i.status === "Open" ? "ACTIVE" : i.status.toUpperCase()}`, M, y); y += 14;
  const assessment = i.verification === "verified" ? "Consistent" : isReviewOnly(i) ? "Unclear" : "Conflicting";
  const verificationLabel = i.publication === "public" && i.verification === "needs_review"
    ? "COMMUNITY CORROBORATED"
    : i.verification === "verified" ? "AI CHECK PASSED (evidence consistency)"
      : i.verification === "needs_review" ? "NEEDS REVIEW" : "NOT PUBLISHED";
  doc.text(`Publication: ${publicationEventLabel(i)}   |   Verification: ${verificationLabel}`, M, y); y += 14;
  doc.text(`Evidence assessment: ${assessment}   |   Origin: ${originMeta(i.origin).label}`, M, y); y += 14;
  doc.text(`Community: ${i.confirmations_yes ? `${i.confirmations_yes} independent confirmation(s)` : "No confirmations yet"}   |   Last updated: ${fmtDateTime(i.last_confirmed_at ?? i.created_at)}`, M, y);
  y += 26;

  section("What happened");
  body(i.summary || i.description);
  if (i.description && i.description !== i.summary) {
    section("Reporter's description");
    body(i.description);
  }
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
    section("Why this report is in review");
    bullets(i.verification_reasons);
  }
  section("Source references");
  if (i.sources.length) bullets(i.sources.map((s, n) => `[${n + 1}] ${s.title}${s.doc ? ` (${s.doc})` : ""}`));
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
  const [revalidating, setRevalidating] = useState(false);
  const [cachedFetchedAt, setCachedFetchedAt] = useState<string | null>(null);
  const [offlineCopy, setOfflineCopy] = useState(false);
  const distance = useDistance(incident);
  const loadedOnceRef = useRef(false);
  /** Resolves when the IndexedDB read finishes — the network path waits on it
   *  so a failed request can never show an error over a readable cached copy. */
  const cacheReadRef = useRef<Promise<void> | null>(null);
  const errorShownRef = useRef(false);

  /**
   * Cache-first open: a previously visited incident renders instantly from
   * IndexedDB, then the server response replaces it in the background.
   * A stale copy is never presented as unquestionably current — the "Updating…"
   * indicator stays until the network answers.
   */
  useEffect(() => {
    if (!id || authLoading) return;
    let cancelled = false;
    const read = (async () => {
      try {
        const { getCachedDetail } = await import("@/lib/offline-db");
        const cached = await getCachedDetail(id, user?.id);
        if (cancelled || loadedOnceRef.current || !cached) return;
        setIncident(cached.incident as Incident);
        setComments((cached.comments ?? []) as CommentItem[]);
        setMyConfirmation(cached.my_confirmation ?? null);
        setCachedFetchedAt(cached.fetched_at);
        loadedOnceRef.current = true;
        // A cached copy beats an error page: clear any error the (faster)
        // failed request may already have set.
        setError(null);
      } catch {
        /* storage unavailable — the network request below still runs */
      }
    })();
    cacheReadRef.current = read;
    return () => {
      cancelled = true;
    };
  }, [id, authLoading, user?.id]);

  /** Network revalidation — starts immediately, never waits for the cache. */
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const isCancelled = () => cancelled;

    void (async () => {
      setRevalidating(true);
      const retryDelays = [800, 2000]; // brief ladder: a just-published report can 404 on another instance
      for (let attempt = 0; ; attempt++) {
        if (isCancelled()) return;
        let res: Response;
        try {
          res = await authFetch(`/api/incidents/${id}`, { cache: "no-store" });
        } catch {
          // Unreachable/offline. Give the cached read one chance to land before
          // deciding: a readable saved copy must win over an error page.
          if (cacheReadRef.current) await cacheReadRef.current;
          if (isCancelled()) return;
          setRevalidating(false);
          if (loadedOnceRef.current) setOfflineCopy(true);
          else if (!errorShownRef.current) {
            errorShownRef.current = true;
            setError("Could not load this incident. Check your connection and try again.");
          }
          return;
        }
        if (isCancelled()) return;

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 404 && attempt < retryDelays.length) {
            await new Promise((r) => setTimeout(r, retryDelays[attempt]));
            continue;
          }
          if (cacheReadRef.current) await cacheReadRef.current;
          if (isCancelled()) return;
          setRevalidating(false);
          if (loadedOnceRef.current) return; // cached copy stays readable
          if (!errorShownRef.current) {
            errorShownRef.current = true;
            setError(
              res.status === 404
                ? "Could not load this incident. Check the link and try again."
                : data.error ?? "Could not load this incident.",
            );
          }
          return;
        }

        const data = (await res.json()) as {
          incident: Incident;
          comments?: CommentItem[];
          my_confirmation?: { response: "yes" | "no"; at: string } | null;
        };
        if (isCancelled()) return;
        setIncident(data.incident);
        setComments(data.comments ?? []);
        setMyConfirmation(data.my_confirmation ?? null);
        loadedOnceRef.current = true;
        errorShownRef.current = false;
        setError(null);
        setOfflineCopy(false);
        setCachedFetchedAt(null);
        setRevalidating(false);
        try {
          const { putCachedDetail } = await import("@/lib/offline-db");
          await putCachedDetail(id, data.incident, data.comments ?? [], user?.id, data.my_confirmation ?? null);
        } catch { /* storage unavailable */ }
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authed]);

  /** Re-fetch after a background sync (offline actions replaying). */
  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ incidentId?: string }>).detail;
      if (detail?.incidentId !== id) return;
      void (async () => {
        try {
          const res = await authFetch(`/api/incidents/${id}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as {
            incident: Incident;
            comments?: CommentItem[];
            my_confirmation?: { response: "yes" | "no"; at: string } | null;
          };
          setIncident(data.incident);
          setComments(data.comments ?? []);
          setMyConfirmation(data.my_confirmation ?? null);
          loadedOnceRef.current = true;
        } catch { /* ignore */ }
      })();
    };
    window.addEventListener("hillsense:data-updated", onUpdated as EventListener);
    return () => window.removeEventListener("hillsense:data-updated", onUpdated as EventListener);
  }, [id]);

  const isReporter = Boolean(user?.id && incident?.reporter_id && user.id === incident.reporter_id);

  const confirm = async (stillPresent: boolean) => {
    if (myConfirmation) {
      setNotice("You have already responded to this incident.");
      return;
    }
    // Reporter independence, mirrored from the server rule so the user gets an
    // immediate explanation instead of a failed request.
    if (isReporter) {
      setActionError("You cannot confirm your own report. This hazard needs an independent first-hand observation.");
      return;
    }
    setConfirming(true);
    setActionError(null);
    // Offline: queue the confirmation in the outbox and reflect it locally.
    // The server stays the source of truth — counts reconcile after sync.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { enqueue, newOutboxId } = await import("@/lib/offline-db");
      await enqueue({
        id: newOutboxId(),
        kind: "confirmation",
        incident_id: id,
        payload: { response: stillPresent ? "yes" : "no" },
        created_at: new Date().toISOString(),
        state: "pending",
        attempts: 0,
      });
      const confirmationAt = new Date().toISOString();
      const nextConfirmation = { response: stillPresent ? "yes" as const : "no" as const, at: confirmationAt };
      setMyConfirmation(nextConfirmation);
      const nextIncident = incident
        ? {
            ...incident,
            confirmations_yes: (incident.confirmations_yes ?? 0) + (stillPresent ? 1 : 0),
            confirmations_no: (incident.confirmations_no ?? 0) + (stillPresent ? 0 : 1),
          }
        : null;
      setIncident(nextIncident);
      try {
        const { putCachedDetail } = await import("@/lib/offline-db");
        if (nextIncident) await putCachedDetail(id, nextIncident, comments, user?.id, nextConfirmation);
      } catch { /* best-effort */ }
      setNotice("Saved offline — your response will sync when you're back online.");
      setConfirming(false);
      return;
    }
    try {
      let res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", response: stillPresent ? "yes" : "no" }),
      });
      // First click straight after a page refresh can race the session
      // hydration (module token cache not yet populated). Give it one chance
      // to resolve, then retry — the user should never see a false
      // "please sign in" while they are actually signed in.
      if (res.status === 401 && !getAuthToken()) {
        await new Promise((r) => setTimeout(r, 350));
        if (getAuthToken()) {
          res = await authFetch(`/api/incidents/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "confirm", response: stillPresent ? "yes" : "no" }),
          });
        }
      }
      const data = await res.json();
      if (res.status === 401) {
        setActionError("Your session has expired. Please sign in again to confirm hazards.");
        return;
      }
      if (!res.ok) {
        setActionError(data.code === "own_report" ? data.error : data.error ?? "Could not record your response.");
        return;
      }
      setIncident(data.incident as Incident);
      if (data.my_confirmation) setMyConfirmation(data.my_confirmation);
      try {
        const { putCachedDetail } = await import("@/lib/offline-db");
        await putCachedDetail(id, data.incident, comments, user?.id, data.my_confirmation ?? null);
      } catch { /* best-effort */ }
      setNotice(data.message ?? (data.already_confirmed ? "You already responded to this hazard." : "Thanks — your response was recorded."));
    } catch {
      setActionError("Network problem — please try again.");
    } finally {
      setConfirming(false);
    }
  };

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim() || postingComment) return;
    setPostingComment(true);
    setActionError(null);
    const text = commentText.trim();
    // Offline: keep the comment visible locally with a pending marker and
    // queue it. It is NOT claimed as published until the server accepts it.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { enqueue, newOutboxId } = await import("@/lib/offline-db");
      const localId = newOutboxId();
      await enqueue({
        id: localId,
        kind: "comment",
        incident_id: id,
        payload: { body: text },
        created_at: new Date().toISOString(),
        state: "pending",
        attempts: 0,
      });
      const localComment: CommentItem = {
        id: localId,
        user_id: user?.id ?? "",
        author_name: user?.display_name ?? "You",
        author_display_name: user?.display_name ?? "You",
        author_initials: user?.initials,
        author_avatar_url: user?.avatar_url ?? null,
        body: text,
        created_at: new Date().toISOString(),
        local_state: "pending",
      };
      const nextComments = [localComment, ...comments];
      setComments(nextComments);
      setCommentText("");
      try {
        const { putCachedDetail } = await import("@/lib/offline-db");
        await putCachedDetail(id, incident, nextComments, user?.id, myConfirmation);
      } catch { /* best-effort */ }
      setNotice("Saved offline — your update will sync when you're back online.");
      setPostingComment(false);
      return;
    }
    try {
      let res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "comment", body: text }),
      });
      // Same session-hydration race as confirmations: retry once if the token
      // only needed a moment to appear (fresh page load).
      if (res.status === 401 && !getAuthToken()) {
        await new Promise((r) => setTimeout(r, 350));
        if (getAuthToken()) {
          res = await authFetch(`/api/incidents/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "comment", body: text }),
          });
        }
      }
      const data = await res.json();
      if (res.status === 401) {
        setActionError("Your session has expired. Please sign in again to comment.");
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
    // A still-pending offline comment was never posted — just drop it locally.
    const pendingLocal = comments.find((x) => x.id === commentId && x.local_state === "pending");
    if (pendingLocal) {
      try {
        const { deleteOutboxItem } = await import("@/lib/offline-db");
        await deleteOutboxItem(commentId);
      } catch {
        /* outbox unavailable — nothing to clean */
      }
      setComments((c) => c.filter((x) => x.id !== commentId));
      return;
    }
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
  const corroborated = i.publication === "public" && i.verification === "needs_review";
  const reviewOnly = isReviewOnly(i);
  const alreadyResponded = myConfirmation !== null;
  const aiInterp = aiInterpretationOf(i);
  const observedSeverity = i.reporter_details?.observed_severity?.trim();
  const severityDiffers = Boolean(observedSeverity && observedSeverity.toLowerCase() !== i.severity.toLowerCase());
  const yes = i.confirmations_yes ?? 0;
  const updatedAt = i.last_confirmed_at ?? i.created_at;
  const minsConfirmed = minutesSince(updatedAt);
  const reportedLabel = i.origin === "seed" ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`;
  const updatedLabel = yes > 0 ? `Community confirmation · ${fmtAge(minsConfirmed)}` : `Last updated ${fmtAge(minsConfirmed)}`;
  const cachedAgeLabel = cachedFetchedAt ? fmtAge(minutesSince(cachedFetchedAt)) : null;
  const showUpdates = comments.length > 0 || authed;

  const timeline: { label: string; at: string }[] = [
    { label: "Report submitted", at: i.created_at },
    ...(i.verification
      ? [{
          label:
            i.verification === "verified"
              ? "Automatic evidence check: passed"
              : i.verification === "needs_review"
                ? "Automatic evidence check: needs community review"
                : "Automatic evidence check: no usable evidence",
          at: i.created_at,
        }]
      : []),
    { label: publicationEventLabel(i), at: i.pipeline?.saved_at ?? i.created_at },
    ...((i.sources?.length ?? 0) > 0 ? [{ label: `Safety guidance attached (${i.sources.length})`, at: i.created_at }] : []),
    ...(i.status_history ?? []).slice(1).map((h) => ({ label: `Status → ${h.status}`, at: h.at })),
  ];

  return (
    <div className="container-page mx-auto max-w-4xl py-5 sm:py-8">
      {/* ---- Top bar: back, revalidation state, overflow actions ---- */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[13px] font-medium muted hover:opacity-80">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Nearby hazards
        </Link>
        <div className="flex items-center gap-2">
          {revalidating && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] faint" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Updating…
            </span>
          )}
          {!revalidating && offlineCopy && cachedAgeLabel && (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] faint" role="status">
              <WifiOff className="h-3.5 w-3.5" aria-hidden /> Saved copy · last updated {cachedAgeLabel}
            </span>
          )}
          <details className="relative">
            <summary className="btn btn-secondary btn-sm" aria-label="More actions for this incident">
              <MoreHorizontal className="h-4 w-4" aria-hidden /> More
            </summary>
            <div
              className="absolute right-0 z-20 mt-1 w-52 rounded-lg border p-1"
              style={{ background: "var(--surface)", borderColor: "var(--border)", boxShadow: "var(--shadow-card)" }}
            >
              <button
                type="button"
                onClick={() => downloadPDF(i, distance)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-2)]"
              >
                <Download className="h-4 w-4" aria-hidden /> Download PDF
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-2)]"
              >
                <Printer className="h-4 w-4" aria-hidden /> Print
              </button>
            </div>
          </details>
        </div>
      </div>

      <article className="print-sheet card overflow-hidden">
        {/* ---- A. HEADER ---- */}
        <header className="p-4 pb-0 sm:p-6 sm:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={i.severity} />
            <StatusChip status={i.status} tone={reviewOnly ? "review" : "default"} />
            {corroborated ? (
              <span className="chip chip-low"><ShieldCheck className="h-3 w-3" aria-hidden /> COMMUNITY CORROBORATED</span>
            ) : (
              <VerificationChip verification={i.verification} />
            )}
            <OriginChip origin={i.origin} />
          </div>

          {/* The title is what the REPORTER described; the AI's classification is
              secondary and never presented as the established fact. */}
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{reportTitle(i)}</h1>
          {aiInterp && (
            <p className="mt-1.5 text-[12.5px] muted">
              AI interpretation: <span className="font-semibold" style={{ color: "var(--text-2)" }}>{aiInterp}</span>
              {" · "}
              <span className="faint">not an established fact while this report needs review</span>
            </p>
          )}
          {severityDiffers && (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] muted">
              <span>Reporter observed: <strong style={{ color: "var(--text-2)" }}>{observedSeverity}</strong></span>
              <span>HillSense priority: <strong style={{ color: "var(--text-2)" }}>{i.severity}</strong></span>
            </p>
          )}

          <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] muted">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
              {distance ? `${distance} · ${i.location}` : i.location}
              {i.coords_approximate ? " (approximate)" : ""}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-4 w-4 shrink-0" aria-hidden /> {reportedLabel}
            </span>
          </p>
        </header>

        {/* ---- B. PHOTO — full content width, aspect ratio preserved ---- */}
        {i.photo_url && (
          <div className="border-y" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={i.photo_url}
              alt={`Photo evidence submitted with this ${i.incident_type.toLowerCase()} report`}
              className="mx-auto max-h-[65vh] w-full object-contain"
              loading="lazy"
            />
          </div>
        )}

        <div className="p-4 pt-3.5 sm:p-6">
          {/* ---- C. SHORT SUMMARY ---- */}
          <p className="text-[15.5px] leading-relaxed">{i.summary}</p>

          {/* ---- D. COMPACT METADATA ROW ---- */}
          <div className="meta-row mt-3 muted">
            <span>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {updatedLabel}
            </span>
            <span>
              <UsersRound className="h-3.5 w-3.5" aria-hidden />{" "}
              {reviewOnly ? corroborationProgressLabel(yes) : `${yes} independent confirmation${yes === 1 ? "" : "s"}`}
            </span>
            {(i.confirmations_no ?? 0) > 0 && (
              <span>
                {i.confirmations_no} {i.confirmations_no === 1 ? "person reported" : "people reported"} it cleared
              </span>
            )}
            {(i.related_ids?.length ?? 0) > 0 && (
              <span className="chip chip-info !text-[11px]">
                <Layers className="h-3 w-3" aria-hidden /> {i.related_ids?.length} related report{i.related_ids?.length === 1 ? "" : "s"}
              </span>
            )}
            <EvidenceChip assessment={i.verification === "verified" ? "Consistent" : reviewOnly ? "Unclear" : "Conflicting"} />
            {offlineCopy && cachedAgeLabel && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] faint">
                <WifiOff className="h-3.5 w-3.5" aria-hidden /> Cached copy · last updated {cachedAgeLabel}
              </span>
            )}
          </div>

          {/* ---- E. WHAT YOU SHOULD KNOW / F. WHAT TO AVOID ---- */}
          <section className="mt-5 grid gap-5 md:grid-cols-2" aria-label="Safety guidance">
            <div>
              <h2 className="text-[13px] font-bold uppercase tracking-wider muted">What you should know</h2>
              <ol className="mt-2 space-y-1.5">
                {i.immediate_actions.map((a2, n) => (
                  <li key={n} className="flex gap-2.5 text-[13.5px] leading-relaxed">
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold"
                      style={{ background: "var(--low-soft)", color: "var(--low)" }}
                      aria-hidden
                    >
                      {n + 1}
                    </span>
                    {a2}
                  </li>
                ))}
              </ol>
            </div>
            {i.avoid.length > 0 && (
              <div>
                <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wider muted">
                  <Ban className="h-3.5 w-3.5" aria-hidden /> What to avoid
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {i.avoid.map((v, n) => (
                    <li key={n} className="flex gap-2 text-[13.5px] leading-relaxed muted">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
                      {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ---- G. COMMUNITY CONFIRMATION ---- */}
          {i.status !== "Resolved" && (
            <section
              className="mt-5 rounded-lg border p-4"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
              aria-labelledby="confirm-heading"
            >
              <h2 id="confirm-heading" className="text-[14px] font-semibold">
                {reviewOnly ? "Can you confirm this report?" : "Is this hazard still present?"}
              </h2>
              {reviewOnly && (
                <p className="mt-1.5 text-[12.5px] leading-relaxed muted">
                  Not in the public feed yet. Two independent first-hand confirmations publish it.
                </p>
              )}

              {authLoading ? (
                <p className="mt-2 flex items-center gap-2 text-[12.5px] muted">
                  <Spinner className="h-3.5 w-3.5" /> Checking your session…
                </p>
              ) : isReporter ? (
                <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  <p className="flex items-start gap-2 text-[13px] font-semibold">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />
                    Your report is awaiting independent community confirmation.
                  </p>
                  <p className="mt-1 pl-6 text-[12.5px] leading-relaxed muted">
                    You cannot confirm your own report. Residents nearby can confirm what they can see directly.
                  </p>
                </div>
              ) : alreadyResponded ? (
                <div className="mt-3 flex items-start gap-2.5 rounded-lg p-3" style={{ background: "var(--low-soft)" }}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--low)" }} aria-hidden />
                  <div>
                    <p className="text-[13.5px] font-semibold" style={{ color: "var(--low)" }}>
                      Your {myConfirmation.response === "yes" ? "confirmation" : "update"} was recorded.
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
                  <div className="mt-3 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                    <button onClick={() => confirm(true)} disabled={confirming} className="btn btn-primary w-full">
                      <ThumbsUp className="h-4 w-4" aria-hidden /> {reviewOnly ? "Yes, I can confirm" : "Yes, still present"}
                    </button>
                    <button onClick={() => confirm(false)} disabled={confirming} className="btn btn-secondary w-full">
                      <ThumbsDown className="h-4 w-4" aria-hidden /> {reviewOnly ? "No / not present" : "No, it has cleared"}
                    </button>
                    {confirming && <Spinner className="mx-auto h-4 w-4" />}
                  </div>
                  <p className="mt-2 text-[11.5px] faint">
                    One response per person. Confirm only what you can directly observe.
                  </p>
                </>
              ) : (
                <p className="mt-3 rounded-lg p-3 text-[12.5px] muted" style={{ background: "var(--surface)" }}>
                  <Link href={`/login?next=/incident/${i.id}`} className="font-semibold underline" style={{ color: "var(--accent)" }}>
                    Sign in with your phone
                  </Link>{" "}
                  to confirm whether this hazard is still present. One response per person keeps the alert trustworthy.
                </p>
              )}

              {notice && <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--low)" }} role="status">{notice}</p>}
              {actionError && <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--danger)" }} role="alert">{actionError}</p>}
            </section>
          )}

          {/* ---- H. SECONDARY — everything else collapses ---- */}
          <div className="mt-5 border-b" style={{ borderColor: "var(--border)" }} />

          {i.verification === "rejected" ? (
            <div className="mt-4 rounded-lg p-4" style={{ background: "var(--danger-soft)" }}>
              <p className="text-[13px] font-semibold" style={{ color: "var(--danger)" }}>
                This report was not published. Its evidence did not consistently support the reported hazard, and it
                is shown here only for the reporter.
              </p>
            </div>
          ) : (
            <Disclosure title={reviewSectionTitle(i)} tone={reviewOnly ? "warn" : "default"}>
              <ul className="check-list space-y-1.5">
                {(i.verification_reasons?.length
                  ? i.verification_reasons
                  : ["Evidence consistency checked by the HillSense pipeline"]
                ).map((r, n) => (
                  <li key={n}>{r}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11.5px] faint">
                AI checks whether the available report evidence is consistent. It does not determine whether a person
                is truthful.
              </p>
            </Disclosure>
          )}

          {i.severity_reasons && i.severity_reasons.length > 0 && (
            <Disclosure title={`Why ${i.severity.toLowerCase()} priority?`}>
              <ul className="check-list space-y-1.5">
                {i.severity_reasons.map((r, n) => (
                  <li key={n}>{r}</li>
                ))}
              </ul>
              <p className="mt-2 text-[11.5px] faint">
                HillSense priority is derived from the reported impact and the evidence available — it is not an
                official emergency classification.
              </p>
            </Disclosure>
          )}

          <Disclosure title="What the reporter sent">
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{i.description || i.summary}</p>
            {i.reporter_details && (
              <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-[12.5px] muted sm:grid-cols-2">
                {i.reporter_details.when && (
                  <div>When: <span style={{ color: "var(--text-2)" }}>{i.reporter_details.when_exact ?? i.reporter_details.when}</span></div>
                )}
                {i.reporter_details.happening_now && (
                  <div>Happening now: <span style={{ color: "var(--text-2)" }}>{i.reporter_details.happening_now}</span></div>
                )}
                {i.reporter_details.affected?.length ? (
                  <div>Affected: <span style={{ color: "var(--text-2)" }}>{i.reporter_details.affected.join(", ")}</span></div>
                ) : null}
                {i.reporter_details.casualties && (
                  <div>People affected: <span style={{ color: "var(--text-2)" }}>{i.reporter_details.casualties}</span></div>
                )}
                {i.reporter_details.observed_severity && (
                  <div>Reporter observed: <span style={{ color: "var(--text-2)" }}>{i.reporter_details.observed_severity}</span></div>
                )}
              </dl>
            )}
            {i.needs_verification && (
              <p className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>
                {i.verification_note ?? "On-site verification recommended."}
              </p>
            )}
            <p className="mt-2.5 text-[11.5px] faint">
              Reported by a community member. Identities and phone numbers are never published.
            </p>
          </Disclosure>

          <Disclosure title="Incident history">
            <p className="text-[12.5px] muted">
              {reportedLabel} <span className="faint">·</span> {updatedLabel}
            </p>
            <ol className="relative mt-3 space-y-3 border-l pl-5" style={{ borderColor: "var(--border)" }}>
              {timeline.map((t, n) => (
                <li key={n} className="relative">
                  <span className="absolute -left-[25px] h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
                  <div className="text-[13px]">{t.label}</div>
                  <div className="mono text-[10.5px] faint">{fmtDateTime(t.at)}</div>
                </li>
              ))}
            </ol>
          </Disclosure>

          <Disclosure title="Location on map">
            {i.coords_approximate && (
              <p className="mb-2 text-[12px]" style={{ color: "var(--warn)" }}>
                Approximate location — exact coordinates were not captured for this report.
              </p>
            )}
            <IncidentMap incidents={[i]} />
            <p className="mt-2 text-[11px] faint">
              Base map © OpenStreetMap contributors. Coordinates: {i.lat.toFixed(4)}, {i.lng.toFixed(4)}
              {i.coords_approximate ? " (approximate)" : ""}
            </p>
          </Disclosure>

          {i.sources.length > 0 && (
            <Disclosure title="View sources">
              <SourcesPanel
                sources={i.sources.map((s, n) => ({ id: `${i.id}-${n}`, title: s.title, doc: s.doc ?? "", excerpt: "", score: 0 }))}
              />
            </Disclosure>
          )}
          <div className="border-t" style={{ borderColor: "var(--border)" }} />

          {/* ---- Community updates ---- */}
          {showUpdates && (
            <section className="no-print mt-6" aria-labelledby="updates-heading">
              <h2 id="updates-heading" className="flex items-center gap-2 text-[15px] font-bold">
                <MessageSquare className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} aria-hidden />
                Community updates
                {comments.length > 0 && <span className="text-[12px] font-normal muted">({comments.length})</span>}
              </h2>
              <p className="mt-1 text-[12px] muted">
                Observations from people nearby — community contributions, not verified facts.
              </p>

              {authLoading ? (
                <p className="mt-4 flex items-center gap-2 text-[12.5px] muted">
                  <Spinner className="h-3.5 w-3.5" /> Checking your session…
                </p>
              ) : authed ? (
                <form onSubmit={postComment} className="mt-4">
                  <textarea
                    className="input min-h-[84px] resize-y"
                    placeholder="Share what you saw — e.g. “The road is still blocked.” or “Traffic is being diverted.”"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    maxLength={600}
                    aria-label="Write a community update"
                  />
                  <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[11px] faint sm:order-first">
                      {commentText.length}/600 · posted as {user?.display_name}
                    </span>
                    <button
                      type="submit"
                      disabled={postingComment || !commentText.trim()}
                      className="btn btn-primary w-full justify-center sm:w-auto"
                    >
                      {postingComment ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <SendHorizontal className="h-3.5 w-3.5" aria-hidden />}
                      Post update
                    </button>
                  </div>
                </form>
              ) : (
                <p className="mt-4 rounded-lg p-3 text-[12.5px] muted" style={{ background: "var(--surface-2)" }}>
                  <Link href={`/login?next=/incident/${i.id}`} className="font-semibold underline" style={{ color: "var(--accent)" }}>
                    Sign in
                  </Link>{" "}
                  to post a community update.
                </p>
              )}

              {comments.length > 0 && (
                <ul className="mt-5 space-y-3">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded-lg border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        {c.author_avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.author_avatar_url}
                            alt=""
                            className="h-6 w-6 shrink-0 rounded-full object-cover"
                            style={{ border: "1px solid var(--border)" }}
                          />
                        ) : (
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                          >
                            {c.author_initials ?? c.author_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                          </span>
                        )}
                        <span className="text-[13px] font-semibold">{c.author_display_name ?? c.author_name}</span>
                        {c.local_state === "pending" && (
                          <span className="chip chip-neutral !text-[10px]" title="Saved on this device — waiting to sync">
                            Pending sync
                          </span>
                        )}
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
                            {deletingCommentId === c.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Trash2 className="h-3 w-3" aria-hidden />}
                            Delete
                          </button>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <footer className="mt-7 flex items-start gap-3 rounded-lg p-4" style={{ background: "var(--danger-soft)" }}>
            <Phone className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--danger)" }}>
              <strong>For life-threatening emergencies, call 112.</strong> HillSense is a community awareness tool:
              reports are checked by AI for evidence consistency, but it is not an official alert channel — always
              follow your district administration&apos;s instructions.
              {i.origin === "seed" && " This incident is seeded demonstration data."}
            </p>
          </footer>
        </div>
      </article>
    </div>
  );
}
