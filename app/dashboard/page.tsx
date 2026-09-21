"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  LayoutDashboard, RefreshCw, Search, Radio, ShieldAlert, HelpCircle, Clock,
  CheckCircle2, Layers, ExternalLink, Cpu, BookOpenCheck,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import type { Incident } from "@/lib/types";
import { SEVERITIES, INCIDENT_TYPES, LOCATIONS } from "@/lib/threat";
import { fmtDate } from "@/lib/labels";
import { needsReconfirmation, detectClusters, fmtAge, minutesSince } from "@/lib/geo";
import { SeverityChip, VerificationChip, OriginChip } from "@/components/Badge";
import { Spinner } from "@/components/Spinner";

const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => <div className="flex h-[380px] items-center justify-center"><Spinner className="h-5 w-5" /></div>,
});

const TYPE_COLORS = ["#0e7490", "#155e75", "#1d4ed8", "#4f46e5", "#7c3aed", "#b91c1c", "#c2410c", "#a16207", "#15803d"];

export default function DashboardPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [clusters, setClusters] = useState<ReturnType<typeof detectClusters>>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rag, setRag] = useState<{ docs: number; aiAvailable: boolean } | null>(null);

  const [severity, setSeverity] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [verification, setVerification] = useState("");
  const [location, setLocation] = useState("");
  const [q, setQ] = useState("");

  const load = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      const list = data.incidents as Incident[];
      setIncidents(list);
      setClusters(detectClusters(list));
    } catch {
      setError("Could not load incidents. Is the server running? Try Refresh.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      load();
      fetch("/api/rag-status").then((r) => r.json()).then(setRag).catch(() => setRag(null));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    let list = incidents ?? [];
    if (severity) list = list.filter((i) => i.severity === severity);
    if (type) list = list.filter((i) => i.incident_type === type);
    if (status) list = list.filter((i) => i.status === status);
    if (verification) list = list.filter((i) => (i.verification ?? "") === verification);
    if (location) list = list.filter((i) => i.location === location);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.id.toLowerCase().includes(needle) ||
          i.summary.toLowerCase().includes(needle) ||
          i.description.toLowerCase().includes(needle) ||
          i.location.toLowerCase().includes(needle),
      );
    }
    return list;
  }, [incidents, severity, type, status, verification, location, q]);

  const stats = useMemo(() => {
    const list = incidents ?? [];
    return {
      active: list.filter((i) => i.status !== "Resolved").length,
      critical: list.filter((i) => i.severity === "Critical" && i.status !== "Resolved").length,
      needsReview: list.filter(
        (i) =>
          (i.verification === "needs_review" || i.needs_verification === true) &&
          i.status !== "Resolved",
      ).length,
      stale: list.filter((i) => needsReconfirmation(i)).length,
      resolved: list.filter((i) => i.status === "Resolved").length,
    };
  }, [incidents]);

  const typeData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of incidents ?? []) counts.set(i.incident_type, (counts.get(i.incident_type) ?? 0) + 1);
    return [...counts.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [incidents]);

  const setStatusFor = async (id: string, status: Incident["status"]) => {
    // Optimistic update, but remember the previous value so a failed request
    // rolls the row back instead of silently showing a status that never saved.
    let previous: Incident["status"] | undefined;
    setIncidents((prev) =>
      (prev ?? []).map((i) => {
        if (i.id !== id) return i;
        previous = i.status;
        return { ...i, status };
      }),
    );
    try {
      const res = await fetch(`/api/incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { incident?: Incident };
      if (data.incident) {
        // Reconcile with the server's record (covers no-op / extra history).
        setIncidents((prev) => (prev ?? []).map((i) => (i.id === id ? data.incident! : i)));
      }
    } catch {
      if (previous !== undefined) {
        setIncidents((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, status: previous! } : i)));
      }
      setError("Could not update the incident status. Check your connection and try again.");
    }
  };

  const hasFilters = severity || type || status || verification || location || q.trim();

  const TILES = [
    { key: "active", label: "Active incidents", icon: Radio, color: "var(--accent)", bg: "var(--accent-soft)" },
    { key: "critical", label: "Critical", icon: ShieldAlert, color: "var(--danger)", bg: "var(--danger-soft)" },
    { key: "needsReview", label: "Needs review", icon: HelpCircle, color: "var(--warn)", bg: "var(--warn-soft)" },
    { key: "stale", label: "Stale (unconfirmed)", icon: Clock, color: "var(--high)", bg: "var(--high-soft)" },
    { key: "resolved", label: "Resolved", icon: CheckCircle2, color: "var(--low)", bg: "var(--low-soft)" },
  ] as const;

  return (
    <div className="container-page py-6 sm:py-8">
      {/* Heading */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight sm:text-2xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "var(--accent-soft)" }}>
              <LayoutDashboard className="h-4.5 w-4.5" style={{ color: "var(--accent)" }} />
            </span>
            HillSense Command Center
          </h1>
          <p className="mt-2 text-[13.5px] muted">
            Incident Intelligence — Demonstration Data. Operations monitoring &amp; triage; the public
            feed at <Link href="/" className="underline" style={{ color: "var(--accent)" }}>/</Link> shows
            only safety-checked public alerts.
          </p>
        </div>
        <div className="btn-row sm:shrink-0">
          {rag && (
            <>
              <span className="chip chip-neutral max-sm:!whitespace-normal max-sm:!text-left" title="Safety knowledge base status">
                <BookOpenCheck className="h-3 w-3 shrink-0" />
                Safety knowledge base · {rag.docs} sources
              </span>
              <span className={`chip ${rag.aiAvailable ? "chip-low" : "chip-warn"}`}>
                <Cpu className="h-3 w-3 shrink-0" />
                {rag.aiAvailable ? "AI services available" : "AI services limited"}
              </span>
            </>
          )}
          <button onClick={load} className="btn btn-secondary">
            {refreshing ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="card mb-6 p-4 text-[13px]" style={{ color: "var(--danger)" }}>{error}</div>}

      {/* Ops tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {TILES.map(({ key, label, icon: Icon, color, bg }) => (
          <div key={key} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: bg }}>
                <Icon className="h-4 w-4" style={{ color }} />
              </span>
            </div>
            <div className="mt-3 text-2xl font-bold tabular-nums">{incidents === null ? "—" : stats[key]}</div>
            <div className="text-[12px] muted">{label}</div>
          </div>
        ))}
      </div>

      {/* Map + chart */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">Incident map</h2>
            <div className="flex flex-wrap items-center gap-2.5">
              {SEVERITIES.map((s) => (
                <span key={s} className="flex items-center gap-1 text-[11px] muted">
                  <span className={`chip chip-${s.toLowerCase()} !px-2 !py-px !text-[10px]`}>{s}</span>
                </span>
              ))}
            </div>
          </div>
          {incidents === null ? (
            <div className="flex h-[380px] items-center justify-center rounded-lg border" style={{ borderColor: "var(--border)" }}>
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <IncidentMap incidents={filtered} />
          )}
        </div>
        <div className="card p-4">
          <h2 className="mb-3 text-[13px] font-semibold">Incidents by type</h2>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeData} layout="vertical" margin={{ top: 0, right: 12, left: 30, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: "var(--text-2)", fontSize: 10 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fill: "var(--text-2)", fontSize: 10 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(14,116,144,0.06)" }}
                  contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {typeData.map((d, i) => (
                    <Cell key={d.name} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Clusters */}
      {clusters.length > 0 && (
        <div className="card mt-4 p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <Layers className="h-4 w-4" style={{ color: "var(--accent)" }} />
            Related incident clusters
            <span className="font-normal muted">— reports linked by location and time.</span>
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {clusters.map((c) => (
              <div key={c.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-warn">DEVELOPING HAZARD CLUSTER</span>
                  <span className="text-[14px] font-semibold">{c.label}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] muted">
                  {c.types.map((t) => (
                    <span key={t.type}>{t.count}× {t.type}</span>
                  ))}
                  <span>window ≈ {c.windowMins < 60 ? `${c.windowMins} min` : `${Math.round(c.windowMins / 60)} hr`}</span>
                </div>
                <p className="mt-2 text-[12.5px] muted">
                  Multiple related incidents have appeared in the same region within a short period.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {c.incidents.map((g) => (
                    <Link key={g.id} href={`/incident/${g.id}`} className="chip chip-neutral hover:opacity-80">
                      {g.id} · {g.incident_type}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters + table */}
      <div className="card mt-4 p-4">
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input !py-2 !text-[12.5px]">
            <option value="">All severities</option>
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className="input !py-2 !text-[12.5px]">
            <option value="">All types</option>
            {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input !py-2 !text-[12.5px]">
            <option value="">All statuses</option>
            <option value="Open">Open</option>
            <option value="Responding">Active</option>
            <option value="Resolved">Resolved</option>
          </select>
          <select value={verification} onChange={(e) => setVerification(e.target.value)} className="input !py-2 !text-[12.5px]">
            <option value="">All verification</option>
            <option value="verified">AI check passed</option>
            <option value="needs_review">Needs review</option>
            <option value="rejected">Not published</option>
          </select>
          <select value={location} onChange={(e) => setLocation(e.target.value)} className="input !py-2 !text-[12.5px]">
            <option value="">All locations</option>
            {LOCATIONS.map((l) => <option key={l.name}>{l.name}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="input !py-2 !pl-8 !text-[12.5px]" />
          </div>
        </div>

        {hasFilters && (
          <div className="mb-3 text-[12px] muted">
            {filtered.length} of {incidents?.length ?? 0} incidents shown
            <button onClick={() => { setSeverity(""); setType(""); setStatus(""); setVerification(""); setLocation(""); setQ(""); }} className="ml-3 underline" style={{ color: "var(--accent)" }}>
              Clear filters
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b text-[10.5px] uppercase tracking-wider faint" style={{ borderColor: "var(--border)" }}>
                <th className="py-2.5 pr-4 font-semibold">ID / origin</th>
                <th className="py-2.5 pr-4 font-semibold">Location</th>
                <th className="py-2.5 pr-4 font-semibold">Type</th>
                <th className="py-2.5 pr-4 font-semibold">Severity</th>
                <th className="py-2.5 pr-4 font-semibold">Verification</th>
                <th className="py-2.5 pr-4 font-semibold">Freshness</th>
                <th className="py-2.5 pr-4 font-semibold">Status</th>
                <th className="py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {incidents === null ? (
                <tr><td colSpan={8} className="py-10 text-center"><Spinner className="mx-auto h-5 w-5" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-10 text-center muted">No incidents match the current filters.</td></tr>
              ) : (
                filtered.map((i) => (
                    <tr key={i.id} className="border-b transition hover:bg-[var(--surface-2)]" style={{ borderColor: "var(--border)" }}>
                      <td className="py-3 pr-4">
                        <span className="mono text-[12px]" style={{ color: "var(--accent)" }}>{i.id}</span>
                        <span className="mt-0.5 block"><OriginChip origin={i.origin} /></span>
                      </td>
                      <td className="py-3 pr-4">
                        {i.location}
                        {i.coords_approximate && <span className="ml-1 text-[10px] muted">(approx.)</span>}
                      </td>
                      <td className="py-3 pr-4">{i.incident_type}</td>
                      <td className="py-3 pr-4"><SeverityChip severity={i.severity} /></td>
                      <td className="py-3 pr-4"><VerificationChip verification={i.verification ?? (i.needs_verification ? "needs_review" : undefined)} /></td>
                      <td className="py-3 pr-4 text-[12px] muted">
                        {i.origin === "seed" ? fmtDate(i.created_at) : fmtAge(minutesSince(i.created_at))}
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          value={i.status}
                          onChange={(e) => setStatusFor(i.id, e.target.value as Incident["status"])}
                          className="input !w-auto !px-1.5 !py-1 !text-[11.5px]"
                          aria-label={`Status for ${i.id}`}
                        >
                          <option value="Open">Open</option>
                          <option value="Responding">Active</option>
                          <option value="Resolved">Resolved</option>
                        </select>
                      </td>
                      <td className="py-3 text-right">
                        <Link href={`/incident/${i.id}`} className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--accent)" }}>
                          Open <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] faint">
          Status changes persist immediately. All rows are example data — nothing here is a live alert.
        </p>
      </div>
    </div>
  );
}
