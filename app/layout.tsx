import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Mountain, Siren, LayoutDashboard, MessageCircleQuestion, ScrollText } from "lucide-react";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HillSense AI — Disaster Intelligence for Mountain Communities",
  description:
    "AI-powered disaster intelligence and response copilot for hilly regions: report incidents by text, image or voice and get grounded, actionable guidance.",
};

const NAV = [
  { href: "/", label: "Home", icon: Mountain },
  { href: "/report", label: "Report Incident", icon: Siren },
  { href: "/dashboard", label: "Command Center", icon: LayoutDashboard },
  { href: "/ask", label: "Ask HillSense", icon: MessageCircleQuestion },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-[#223041] bg-[#0b0f14]/90 backdrop-blur no-print">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/40">
                <Mountain className="h-4.5 w-4.5 text-sky-400" />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">
                HillSense <span className="text-sky-400">AI</span>
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-[#8ba1b7] transition hover:bg-[#141c25] hover:text-white"
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              ))}
              <Link
                href="/report"
                className="ml-2 hidden md:flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-[13px] font-semibold text-[#06232f] transition hover:bg-sky-400"
              >
                <ScrollText className="h-4 w-4" />
                New Report
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
