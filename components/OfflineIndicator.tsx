"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

type SyncState = { pending: number; syncing: boolean; failed: number };

/**
 * Offline experience glue:
 *  1. registers the service worker (app shell + data caching)
 *  2. shows an unobtrusive banner while offline — "changes will sync when
 *     you're back online" — plus sync/failed counts from the outbox
 *  3. kicks the sync loop (F6) whenever connectivity returns
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<SyncState>({ pending: 0, syncing: false, failed: 0 });

  useEffect(() => {
    const onlineInit = setTimeout(() => setOnline(navigator.onLine), 0);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline support is best-effort; the app works without it */
      });
    }

    const goOffline = () => setOnline(false);
    const goOnline = () => {
      setOnline(true);
      void syncNow();
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Reflect outbox state; lib/sync emits this event after every transition.
    const onSyncState = (e: Event) => {
      const detail = (e as CustomEvent<SyncState>).detail;
      if (detail) setSync(detail);
    };
    window.addEventListener("hillsense:sync-state", onSyncState as EventListener);

    // Initial count + sync anything queued by a previous session.
    void (async () => {
      try {
        const [{ listOutbox }, { syncOutbox }] = await Promise.all([
          import("@/lib/offline-db"),
          import("@/lib/sync"),
        ]);
        const items = await listOutbox();
        setSync({
          pending: items.filter((i) => i.state === "pending").length,
          syncing: false,
          failed: items.filter((i) => i.state === "failed").length,
        });
        if (navigator.onLine && items.some((i) => i.state === "pending" || i.state === "failed")) {
          void syncOutbox();
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      clearTimeout(onlineInit);
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("hillsense:sync-state", onSyncState as EventListener);
    };
  }, []);

  async function syncNow() {
    try {
      const { syncOutbox } = await import("@/lib/sync");
      void syncOutbox();
    } catch {
      /* ignore */
    }
  }

  if (online && sync.pending === 0 && sync.failed === 0 && !sync.syncing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 px-3 py-1.5 text-[12px] font-medium"
      style={{
        background: online ? "var(--accent-soft)" : "var(--warn-soft)",
        color: online ? "var(--accent)" : "var(--warn)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {!online && (
        <>
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span>Offline — showing saved data. Changes will sync when you&apos;re back online.</span>
        </>
      )}
      {online && sync.syncing && (
        <>
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>Syncing {sync.pending} saved change{sync.pending === 1 ? "" : "s"}…</span>
        </>
      )}
      {online && !sync.syncing && sync.pending > 0 && (
        <>
          <RefreshCw className="h-3.5 w-3.5 shrink-0" />
          <button type="button" onClick={syncNow} className="underline underline-offset-2">
            {sync.pending} saved change{sync.pending === 1 ? "" : "s"} waiting — sync now
          </button>
        </>
      )}
      {online && !sync.syncing && sync.pending === 0 && sync.failed > 0 && (
        <>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{sync.failed} change{sync.failed === 1 ? "" : "s"} could not sync — they are kept and can be retried.</span>
        </>
      )}
      {online && !sync.syncing && sync.pending === 0 && sync.failed === 0 && (
        <>
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Back online — everything is synced.</span>
        </>
      )}
    </div>
  );
}
