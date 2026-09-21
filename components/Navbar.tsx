"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Mountain, Sun, Moon, MapPin, Siren, LayoutDashboard, MessageCircleQuestion, Map,
  LogIn, LogOut, User as UserIcon, Home,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useLocationPreference } from "@/hooks/useLocationPreference";
import { useAuth } from "@/hooks/useAuth";

const LINKS = [
  { href: "/", label: "Nearby", icon: Mountain },
  { href: "/home", label: "My Feed", icon: Home },
  { href: "/report", label: "Report Hazard", icon: Siren },
  { href: "/dashboard", label: "Map", icon: Map },
  { href: "/ask", label: "Ask HillSense", icon: MessageCircleQuestion },
];

/** Short, deterministic label for the header location pill. */
function headerLocationLabel(label: string): string {
  if (label.includes(",")) return label.split(",")[0]!.trim();
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { loc } = useLocationPreference();
  const { user, authed, loading, signOut } = useAuth();

  return (
    <header className="no-print sticky top-0 z-40 border-b bg-[var(--surface)]" style={{ borderColor: "var(--border)" }}>
      {/* Single container shared with page content — identical max-width & padding. */}
      <div className="container-page flex h-14 items-center gap-2 xl:gap-3">
        {/* Brand: icon always; two-line wordmark only when there is room (xl+) */}
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="HillSense AI home">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--accent-soft)" }}>
            <Mountain className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} />
          </span>
          <span className="hidden leading-tight xl:block">
            <span className="block whitespace-nowrap text-[14.5px] font-bold tracking-tight">
              HillSense <span style={{ color: "var(--accent)" }}>AI</span>
            </span>
            <span className="block whitespace-nowrap text-[10.5px] muted">Community hazard intelligence</span>
          </span>
        </Link>

        {/* Primary nav — md+. Compact .nav-link pills (12.5px, nowrap) so five
            links + utilities always fit; nothing can ever wrap to two lines. */}
        <nav className="mx-auto hidden shrink-0 items-center gap-1 md:flex" aria-label="Primary">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="nav-link flex items-center transition"
                style={{
                  color: active ? "var(--accent)" : "var(--text-2)",
                  background: active ? "var(--accent-soft)" : "transparent",
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Utility cluster — compact 32px controls until xl, then 36px.
            Collapse ladder (narrow → wide): name hides first, then location
            pill & dashboard icon appear only at xl where space is measured. */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 xl:gap-2">
          {loc && (
            <span
              className="hidden h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium xl:flex xl:h-9 xl:px-3 xl:text-[12px]"
              style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
              title={loc.approximate ? `Approximate location — ${loc.label}` : loc.label}
            >
              <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent)" }} />
              {loc.approximate ? `${headerLocationLabel(loc.label)} (approx.)` : headerLocationLabel(loc.label)}
            </span>
          )}

          <Link
            href="/dashboard"
            className="btn btn-ghost btn-header-sm btn-icon hidden xl:inline-flex"
            aria-label="Operations monitoring & triage"
            title="Operations monitoring & triage"
          >
            <LayoutDashboard className="h-4 w-4" />
          </Link>

          <button
            onClick={toggle}
            className="btn btn-ghost btn-header-sm btn-icon"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          {loading ? (
            <span className="h-8 w-8 animate-pulse rounded-lg xl:h-9 xl:w-9" style={{ background: "var(--surface-2)" }} aria-hidden />
          ) : authed && user ? (
            <>
              <Link
                href="/onboarding"
                className="flex h-8 items-center gap-1.5 rounded-lg border py-0 pl-1 pr-2 text-[12px] font-semibold xl:h-9 xl:gap-2 xl:pl-1.5 xl:pr-2.5 xl:text-[12.5px]"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
                title={`Signed in as ${user.display_name}`}
              >
                <span className="flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold xl:h-6 xl:w-6 xl:text-[10.5px]" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  {user.initials}
                </span>
                <span className="hidden max-w-[110px] truncate xl:inline">{user.display_name.split(" ")[0]}</span>
              </Link>
              <button
                onClick={async () => {
                  await signOut();
                  router.push("/");
                }}
                className="btn btn-ghost btn-header-sm btn-icon"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </>
          ) : (              <Link href="/login" className="btn btn-secondary btn-header-sm max-sm:min-w-0 max-sm:!px-2" title="Sign in with your phone number">
                <LogIn className="h-4 w-4" />
                <span className="hidden whitespace-nowrap sm:inline">Sign in</span>
                <UserIcon className="h-4 w-4 sm:hidden" />
              </Link>
          )}

          {/* Primary CTA: icon-only at md (space-critical band), full label lg+ */}
          <Link
            href="/report"
            className="btn btn-header-sm btn-primary hidden md:inline-flex"
            aria-label="Report Hazard"
            title="Report a hazard"
          >
            <Siren className="h-4 w-4 shrink-0" />
            <span className="hidden whitespace-nowrap lg:inline">Report Hazard</span>
          </Link>
        </div>
      </div>

      {/* Mobile nav — 5 equal tabs, flush with the container's horizontal padding.
          Bottom padding clears iOS home-indicator / gesture bars on phones. */}
      <nav className="border-t pb-[max(env(safe-area-inset-bottom),4px)] md:hidden" style={{ borderColor: "var(--border)" }} aria-label="Primary mobile">
        <div className="container-page !px-0">
          <div className="grid grid-cols-5 py-1">
            {LINKS.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1.5 text-center text-[10.5px] font-medium leading-tight"
                  style={{
                    color: active ? "var(--accent)" : "var(--text-2)",
                    background: active ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </header>
  );
}
