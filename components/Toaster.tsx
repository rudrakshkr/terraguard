"use client";

/**
 * Lightweight toast notifications.
 *
 * Usage: `toast("Profile saved")` or `toast("Could not save", "error")` from any
 * client component. Toasts are announced through an aria-live region, auto-dismiss,
 * and sit at the bottom of the viewport so they never cover primary controls or
 * the mobile tab bar.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const EVENT = "hillsense:toast";
let seq = 0;

/** Fire a toast from anywhere (client-side only). */
export function toast(message: string, tone: ToastTone = "success") {
  if (typeof window === "undefined" || !message) return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: ++seq, message, tone } }));
  } catch {
    /* non-browser context */
  }
}

const TTL_MS = 4000;

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const onToast = (event: Event) => {
      const detail = (event as CustomEvent<Toast>).detail;
      if (!detail?.message) return;
      setItems((prev) => [...prev.slice(-2), detail]);
    };
    window.addEventListener(EVENT, onToast as EventListener);
    return () => window.removeEventListener(EVENT, onToast as EventListener);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((t) =>
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), TTL_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [items]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-16 z-[900] flex flex-col items-center gap-2 px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13px]"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            boxShadow: "var(--shadow-card)",
            color: "var(--text)",
          }}
        >
          {t.tone === "error" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} aria-hidden />
          ) : (
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: t.tone === "info" ? "var(--accent)" : "var(--low)" }}
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1 leading-snug">{t.message}</span>
          <button
            type="button"
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            className="mt-0.5 shrink-0 opacity-60 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
