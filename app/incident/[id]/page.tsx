"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft, Download, Printer, MapPin, ShieldCheck, Clock, ThumbsUp, ThumbsDown,
  Phone, HelpCircle, ListChecks, History, Ban, Users, BookOpenCheck, X, MessageSquare,
  SendHorizontal, CheckCircle2, Layers, Trash2, Loader2,
} from "lucide-react";
import type { Incident } from "@/lib/types";
import { fmtDateTime, originMeta } from "@/lib/threat";
import { fmtDistance, fmtAge, minutesSince, freshnessOf, haversineKm } from "@/lib/geo";
import { SeverityChip, StatusChip, VerificationChip, OriginChip, FreshnessChip } from "@/components/Badge";
import { fmtDate, exampleReportLabel } from "@/lib/labels";
import SourcesPanel from "@/components/SourcesPanel";
import { Spinner } from "@/components/Spinner";
import { useAuth, authFetch, getAuthToken } from "@/hooks/useAuth";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => <div className="flex h-[380px] items-center justify-center"><Spinner className="h-5 w-5" /></div>,
});

import { jsPDF } from "jspdf";


const OFFLINE_CONFIRMATION_KEY = "hillsense-offline-confirmation:";

function offlineConfirmationKey(userId: string, incidentId: string): string {
  return `${OFFLINE_CONFIRMATION_KEY}${userId}:${incidentId}`;
}

function readOfflineConfirmation(incidentId: string, userId?: string | null) {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(offlineConfirmationKey(userId, incidentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { response?: "yes" | "no"; at?: string };
    if ((parsed.response !== "yes" && parsed.response !== "no") || typeof parsed.at !== "string") {
      localStorage.removeItem(offlineConfirmationKey(userId, incidentId));
      return null;
    }
    return parsed as { response: "yes" | "no"; at: string };
  } catch {
    return null;
  }
}

function writeOfflineConfirmation(incidentId: string, userId: string | null | undefined, confirmation: { response: "yes" | "no"; at: string } | null) {
  if (!userId) return;
  try {
    const key = offlineConfirmationKey(userId, incidentId);
    if (confirmation) localStorage.setItem(key, JSON.stringify(confirmation));
    else localStorage.removeItem(key);
  } catch {
    /* local storage unavailable */
  }
}

async function cacheIncidentDetail(
  incidentId: string,
  incidentData: unknown,
  commentData: unknown[],
  userId?: string | null,
  confirmation?: { response: "yes" | "no"; at: string } | null,
): Promise<void> {
  try {
    const { putCachedDetail } = await import("@/lib/offline-db");
    await putCachedDetail(incidentId, incidentData, commentData);
    if (userId) writeOfflineConfirmation(incidentId, userId, confirmation ?? null);
  } catch {
    /* storage unavailable */
  }
}

async function readCachedIncidentDetail(
  incidentId: string,
  userId?: string | null,
): Promise<{ incident: unknown; comments: unknown[]; my_confirmation: { response: "yes" | "no"; at: string } | null } | null> {
  try {
    const { getCachedDetail } = await import("@/lib/offline-db");
    const cached = await getCachedDetail(incidentId);
    if (!cached) return null;
    return {
      incident: cached.incident,
      comments: cached.comments ?? [],
      my_confirmation: readOfflineConfirmation(incidentId, userId),
    };
  } catch {
    return null;
  }
}

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
  doc.text(`${i.id} — ${i.incident_type} (${i.severity})`, M, y); y += 22;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(90, 104, 120);
  doc.text(`Location: ${i.location}${i.coords_approximate ? " (approximate)" : ""}${distanceLabel ? ` · ${distanceLabel}` : ""}`, M, y); y += 14;
  doc.text(`Reported: ${i.origin === "seed" ? fmtDate(i.created_at) : fmtDateTime(i.created_at)}   |   Status: ${i.status === "Open" ? "ACTIVE" : i.status.toUpperCase()}`, M, y); y += 14;
  const assessment = i.verification === "verified" ? "Consistent" : i.verification === "needs_review" ? "Unclear" : "Conflicting";
  doc.text(`Verification: ${i.verification === "verified" ? "AI CHECK PASSED (evidence consistency)" : i.verification === "needs_review" ? "NEEDS REVIEW" : "NOT PUBLISHED"}   |   Evidence assessment: ${assessment}`, M, y); y += 14;
  doc.text(`Origin: ${originMeta(i.origin).label}   |   ${i.confirmations_yes ? `Community confirmation (${i.confirmations_yes})` : "Last updated"}: ${fmtDateTime(i.last_confirmed_at ?? i.created_at)}`, M, y);
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
  const [myConfirmation, setMyConfirmation] = useState<{
    response: "yes" | "no";
    at: string;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const distance = useDistance(incident);
  const loadedOnceRef = useRef(false);

  const fetchOnce = () => {
    authFetch(`/api/incidents/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();

        if (!r.ok) {
          throw new Error(data.error ?? "failed");
        }

        setIncident(data.incident as Incident);
        setComments((data.comments ?? []) as CommentItem[]);
        setMyConfirmation(data.my_confirmation ?? null);
        loadedOnceRef.current = true;
        setError(null);

        // Persist the incident for offline viewing.
        await cacheIncidentDetail(
          id,
          data.incident,
          data.comments ?? [],
          user?.id,
          data.my_confirmation ?? null,
        );
      })
      .catch((e: unknown) => {
        // Do not replace already-loaded data with an error.
        if (incident || loadedOnceRef.current) return;

        // Offline / server unreachable:
        // fall back to the last cached copy.
        void (async () => {
          const cached = await readCachedIncidentDetail(id, user?.id);

          if (cached) {
            setIncident(cached.incident as Incident);
            setComments(cached.comments as CommentItem[]);
            setMyConfirmation(cached.my_confirmation);
            loadedOnceRef.current = true;
            setNotice(
              "Showing the saved copy from your last visit (offline).",
            );
            return;
          }

          setError(
            "Could not load this incident. Check the link and try again.",
          );
        })();

        void e;
      });
  };

  const load = () => {
    // Signed-in users receive my_confirmation from the API.
    // Guests receive the public incident view.
    //
    // Brief retry ladder in case a newly-created incident is temporarily
    // unavailable across serverless instances/regions.
    const delays = [0, 800, 2000];

    const attempts = delays.map(
      (delay) =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            fetchOnce();
            resolve();
          }, delay);
        }),
    );

    return Promise.allSettled(attempts);
  };

  useEffect(() => {
    if (!id) return;

    const t = setTimeout(() => {
      void load();
    }, 0);

    return () => clearTimeout(t);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authed]);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          incidentId?: string;
          kind?: string;
        }>
      ).detail;

      if (detail?.incidentId === id) {
        void fetchOnce();
      } else if (detail?.kind === "profile") {
        void fetchOnce();
      }
    };

    window.addEventListener(
      "hillsense:data-updated",
      onUpdated as EventListener,
    );

    return () =>
      window.removeEventListener(
        "hillsense:data-updated",
        onUpdated as EventListener,
      );

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const confirm = async (stillPresent: boolean) => {
    if (myConfirmation) {
      setNotice("You have already responded to this incident.");
      return;
    }

    setConfirming(true);
    setActionError(null);

    // Offline:
    // queue the confirmation locally and update the UI immediately.
    // The server remains the source of truth after synchronization.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { enqueue, newOutboxId } = await import("@/lib/offline-db");

      await enqueue({
        id: newOutboxId(),
        kind: "confirmation",
        incident_id: id,
        payload: {
          response: stillPresent ? "yes" : "no",
        },
        created_at: new Date().toISOString(),
        state: "pending",
        attempts: 0,
      });

      const confirmationAt = new Date().toISOString();

      const nextConfirmation = {
        response: stillPresent ? ("yes" as const) : ("no" as const),
        at: confirmationAt,
      };

      setMyConfirmation(nextConfirmation);

      const nextIncident = incident
        ? {
            ...incident,
            confirmations_yes:
              (incident.confirmations_yes ?? 0) +
              (stillPresent ? 1 : 0),
            confirmations_no:
              (incident.confirmations_no ?? 0) +
              (stillPresent ? 0 : 1),
          }
        : null;

      setIncident(nextIncident);

      if (nextIncident) {
        await cacheIncidentDetail(
          id,
          nextIncident,
          comments,
          user?.id,
          nextConfirmation,
        );
      }

      writeOfflineConfirmation(
        id,
        user?.id,
        nextConfirmation,
      );

      setNotice(
        "Saved offline — your response will sync when you're back online.",
      );

      setConfirming(false);
      return;
    }

    try {
      let res = await authFetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "confirm",
          response: stillPresent ? "yes" : "no",
        }),
      });

      // A first click immediately after refresh can race session hydration.
      // Give the auth token a brief chance to become available, then retry.
      if (res.status === 401 && !getAuthToken()) {
        await new Promise((r) => setTimeout(r, 350));

        if (getAuthToken()) {
          res = await authFetch(`/api/incidents/${id}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "confirm",
              response: stillPresent ? "yes" : "no",
            }),
          });
        }
      }

      const data = await res.json();

      if (res.status === 401) {
        setActionError(
          "Your session has expired. Please sign in again to confirm hazards.",
        );
        return;
      }

      if (!res.ok) {
        setActionError(
          data.error ?? "Could not record your response.",
        );
        return;
      }

      setIncident(data.incident as Incident);

      if (data.my_confirmation) {
        setMyConfirmation(data.my_confirmation);
      }

      await cacheIncidentDetail(
        id,
        data.incident,
        comments,
        user?.id,
        data.my_confirmation ?? null,
      );

      setNotice(
        data.message ??
          (data.already_confirmed
            ? "You already responded to this hazard."
            : "Thanks — your response was recorded."),
      );
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
      setComments((c) => [
        {
          id: localId,
          user_id: user?.id ?? "",
          author_name: user?.display_name ?? "You",
          author_display_name: user?.display_name ?? "You",
          author_initials: user?.initials,
          author_avatar_url: user?.avatar_url ?? null,
          body: text,
          created_at: new Date().toISOString(),
          local_state: "pending",
        } as CommentItem,
        ...c,
      ]);
      setCommentText("");
      const nextComments = [{
        id: localId,
        user_id: user?.id ?? "",
        author_name: user?.display_name ?? "You",
        author_display_name: user?.display_name ?? "You",
        author_initials: user?.initials,
        author_avatar_url: user?.avatar_url ?? null,
        body: text,
        created_at: new Date().toISOString(),
        local_state: "pending" as const,
      }, ...comments];
      await cacheIncidentDetail(id, incident, nextComments, user?.id, myConfirmation);
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
  const fresh = freshnessOf(i);
  const minsConfirmed = minutesSince(i.last_confirmed_at ?? i.created_at);
  const alreadyResponded = myConfirmation !== null;
  const timeline: { label: string; at: string }[] = [
    { label: `Report submitted (${originMeta(i.origin).label})`, at: i.created_at },
    ...(i.verification ? [{ label: `AI evidence check: ${i.verification === "verified" ? "passed" : i.verification === "needs_review" ? "needs review" : "failed — not published"}`, at: i.created_at }] : []),
    ...((i.sources?.length ?? 0) > 0 ? [{ label: `Safety guidance attached (${i.sources.length})`, at: i.created_at }] : []),
    ...(i.pipeline?.saved_at ? [{ label: "Published / saved", at: i.pipeline.saved_at }] : []),
    ...(i.status_history ?? []).slice(1).map((h) => ({ label: `Status → ${h.status}`, at: h.at })),
  ];

  return (
    <div className="container-page mx-auto max-w-4xl py-6 sm:py-8">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-[13px] font-medium muted hover:opacity-80">
          <ArrowLeft className="h-4 w-4" /> Nearby hazards
        </Link>
        <div className="btn-row">
          <button onClick={() => downloadPDF(i, distance)} className="btn btn-secondary">
            <Download className="h-4 w-4" /> Download PDF
          </button>
          <button onClick={() => window.print()} className="btn btn-ghost">
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      <article className="print-sheet card p-4 sm:p-6 md:p-8">
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
            <span className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {i.origin === "seed" ? exampleReportLabel(i.created_at) : `Reported ${fmtAge(minutesSince(i.created_at))}`}
            </span>
          </p>
          <p className="mt-3 text-[15.5px] leading-relaxed">{i.summary}</p>
          {i.photo_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={i.photo_url}
              alt={`Photo evidence submitted with this ${i.incident_type.toLowerCase()} report`}
              className="mt-3 max-h-96 w-auto rounded-lg border"
              style={{ borderColor: "var(--border)" }}
              loading="lazy"
            />
          )}
        </header>

        {/* Freshness + corroboration */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {i.origin === "seed" ? (
            <span className="chip chip-neutral" title="Static demonstration data — timestamps are examples, not live">
              <span className="dot" />
              {exampleReportLabel(i.created_at)}
            </span>
          ) : (
            <FreshnessChip
              fresh={fresh}
              minsSinceConfirmed={minsConfirmed}
              confirmations={i.confirmations_yes ?? 0}
            />
          )}
          {(i.confirmations_no ?? 0) > 0 && (
            <span className="chip chip-neutral">
              {i.confirmations_no} {i.confirmations_no === 1 ? "person reported" : "people reported"} it cleared
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
                <div className="mt-3 grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
                  <button onClick={() => confirm(true)} disabled={confirming} className="btn btn-primary w-full">
                    <ThumbsUp className="h-4 w-4" /> Yes, still present
                  </button>
                  <button onClick={() => confirm(false)} disabled={confirming} className="btn btn-secondary w-full">
                    <ThumbsDown className="h-4 w-4" /> No, it has cleared
                  </button>
                  {confirming && <Spinner className="mx-auto h-4 w-4" />}
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
              {i.verification === "verified" ? "Why this report passed the AI check" : "Why this report is in review"}
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
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Current status</div>
            <div className="mt-1"><StatusChip status={i.status} /></div>
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">
              {(i.confirmations_yes ?? 0) > 0 ? "Community confirmation" : "Last updated"}
            </div>
            <div className="mt-1">
              {(i.confirmations_yes ?? 0) > 0
                ? `${i.confirmations_yes} confirmation${i.confirmations_yes === 1 ? "" : "s"} · ${i.origin === "seed" ? fmtDate(i.last_confirmed_at ?? i.created_at) : fmtAge(minsConfirmed)}`
                : i.origin === "seed"
                  ? fmtDate(i.last_confirmed_at ?? i.created_at)
                  : fmtAge(minsConfirmed)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider faint">Evidence assessment</div>
            <div className="mt-1">
              <span className={`chip ${i.verification === "verified" ? "chip-low" : i.verification === "needs_review" ? "chip-warn" : "chip-critical"}`}>
                {i.verification === "verified" ? "Consistent" : i.verification === "needs_review" ? "Unclear" : "Conflicting"}
              </span>
            </div>
          </div>
          <div className="min-w-0">
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
            <strong>not</strong> checked facts like the AI CHECK PASSED assessment above.
          </p>

          {authLoading ? (
            <p className="mt-4 flex items-center gap-2 text-[12.5px] muted"><Spinner className="h-3.5 w-3.5" /> Checking your session…</p>
          ) : authed ? (
            <form onSubmit={postComment} className="mt-4">
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder="Share what you saw — e.g. “The road is still blocked.” or “Traffic is being diverted.”"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={600}
                aria-label="Write a comment"
              />
              <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[11px] faint sm:order-first">{commentText.length}/600 · posted as {user?.display_name}</span>
                <button
                  type="submit"
                  disabled={postingComment || !commentText.trim()}
                  className="btn btn-primary w-full justify-center sm:w-auto"
                >
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
                    {c.author_avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.author_avatar_url}
                        alt=""
                        className="h-6 w-6 shrink-0 rounded-full object-cover"
                        style={{ border: "1px solid var(--border)" }}
                      />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
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