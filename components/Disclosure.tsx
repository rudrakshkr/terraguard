"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Secondary information disclosure. Uses the native <details>/<summary>
 * element so it is keyboard accessible and works without JavaScript; the
 * chevron rotates instead of swapping icons.
 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
  tone = "default",
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  tone?: "default" | "warn";
}) {
  return (
    <details className="disclosure group" open={defaultOpen}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 py-3 text-[13.5px] font-semibold">
        <ChevronRight
          className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90"
          style={{ color: tone === "warn" ? "var(--warn)" : "var(--accent)" }}
          aria-hidden
        />
        <span className="min-w-0">{title}</span>
      </summary>
      <div className="pb-4 pl-6 pr-1">{children}</div>
    </details>
  );
}

export default Disclosure;
