"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  LayoutDashboard, ShieldAlert, AlertTriangle, Activity, CheckCircle2,
  Search, RefreshCw, BookOpenCheck, Cpu, ExternalLink,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from "recharts";
import type { Incident } from "@/lib/types";
import { SEVERITIES, SEVERITY_META, INCIDENT_TYPES, LOCATIONS, timeAgo } from "@/lib/threat";
import { SeverityBadge } from "@/components/Badge";
import { Spinner } from "@/components/Spinner";

// Leaflet touches `window` at import time — load the map client-side only.
const IncidentMap = dynamic(() => import("@/components/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-lg border border-[#223041] text-[#4d6275]">
      <Spinner className="h-5 w-5" />
    </div>
  ),
});

const STAT_TILES = [
  { key: "total", label: "Total incidents", icon: LayoutDashboard, cls: "text-sky-400 bg-sky-500/15 ring-sky-500/30" },
  { key: "critical", label: "Critical", icon: ShieldAlert, cls: "text-red-400 bg-red-500/15 ring-red-500/30" },
  { key: "high", label: "High-risk", icon: AlertTriangle, cls: "text-amber-400 bg-amber-500/15 ring-amber-500/30" },
  { key: "moderate", label: "Moderate", icon: Activity, cls: "text-sky-300 bg-sky-500/10 ring-sky-500/25" },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, cls: "text-emerald-400 bg-emerald-500/15 ring-emerald-500/30" },
] as const;

const TYPE_COLORS = ["#38bdf8", "#22d3ee", "#818cf8", "#a78bfa", "#f472b6", "#fb923c", "#facc15", "#4ade80", "#94a3b8"];

export default function DashboardPage() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rag, setRag] = useState<{ docs: number; chunks: number; embedder: string; aiAvailable: boolean } | null>(null);

  const [severity, setSeverity] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [location, setLocation] = useState("");
  const [q, setQ] = useState("");

  const load = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setIncidents(data.incidents as Incident[]);
    } catch {
      setError("Could not load incidents. Is the server running? Try Refresh.");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      load();
      fetch("/api/rag-status")
        .then((r) => r.json())
        .then(setRag)
        .catch(() => setRag(null));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const filtered = useMemo(() => {
    let list = incidents ?? [];
    if (severity) list = list.filter((i) => i.severity === severity);
    if (type) list = list.filter((i) => i.incident_type === type);
    if (status) list = list.filter((i) => i.status === status);
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
  }, [incidents, severity, type, status, location, q]);

  const stats = useMemo(() => {
    const list = incidents ?? [];
    return {
      total: list.length,
      critical: list.filter((i) => i.severity === "Critical").length,
      high: list.filter((i) => i.severity === "High").length,
      moderate: list.filter((i) => i.severity === "Moderate").length,
      resolved: list.filter((i) => i.status === "Resolved").length,
    };
  }, [incidents]);

  const severityData = useMemo(
    () =>
      SEVERITIES.map((s) => ({
        name: s,
        count: (incidents ?? []).filter((i) => i.severity === s).length,
      })),
    [incidents],
  );

  const typeData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of incidents ?? []) counts.set(i.incident_type, (counts.get(i.incident_type) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [incidents]);

  const setStatusFor = async (id: string, status: Incident["status"]) => {
    setIncidents((prev) => (prev ?? []).map((i) => (i.id === id ? { ...i, status } : i)));
    try {
      await fetch(`/api/incidents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch {
      load(); // revert on failure by reloading truth
    }
  };

  const hasFilters = severity || type || status || location || q.trim();

  return (
    <div className="topo min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Heading + system status */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/40">
                <LayoutDashboard className="h-4.5 w-4.5 text-sky-400" />
              </span>
              HillSense Command Center
            </h1>
            <p className="mt-2 text-[13.5px] text-[#8ba1b7]">
              Live incident intelligence across Himachal Pradesh — seeded with demonstration data.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rag && (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#141c25] px-3 py-1.5 text-[11px] font-medium text-[#8ba1b7] ring-1 ring-[#223041]">
                  <BookOpenCheck className="h-3.5 w-3.5 text-emerald-400" />
                  RAG · {rag.docs} docs / {rag.chunks} chunks · {rag.embedder === "api" ? "API embeddings" : "local embeddings"}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium ring-1 ${
                    rag.aiAvailable
                      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                      : "bg-amber-500/10 text-amber-300 ring-amber-500/30"
                  }`}
                >
                  <Cpu className="h-3.5 w-3.5" />
                  {rag.aiAvailable ? "LLM connected" : "Heuristic mode — no API key"}
                </span>
              </>
            )}
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2c3e54] px-3 py-1.5 text-[12px] font-medium text-[#8ba1b7] hover:text-white"
            >
              {refreshing ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="panel mb-6 p-4 text-[13px] text-red-300">{error}</div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STAT_TILES.map(({ key, label, icon: Icon, cls }) => (
            <div key={key} className="panel p-4">
              <div className="flex items-center justify-between">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${cls}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#4d6275]">{key}</span>
              </div>
              <div className="mt-3 text-2xl font-bold tabular-nums">
                {incidents === null ? "—" : stats[key]}
              </div>
              <div className="text-[12px] text-[#8ba1b7]">{label}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="panel p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-[#c6d4e0]">Incidents by severity</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid stroke="#1c2836" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#8ba1b7", fontSize: 11 }} axisLine={{ stroke: "#223041" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: "#8ba1b7", fontSize: 11 }} axisLine={{ stroke: "#223041" }} tickLine={false} />
                  <Tooltip
                    cursor={{ fill: "rgba(56,189,248,0.06)" }}
                    contentStyle={{ background: "#141c25", border: "1px solid #223041", borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {severityData.map((d) => (
                      <Cell key={d.name} fill={SEVERITY_META[d.name as keyof typeof SEVERITY_META].hex} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="panel p-4">
            <h2 className="mb-3 text-[13px] font-semibold text-[#c6d4e0]">Incidents by type</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={typeData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3} stroke="#0b0f14">
                    {typeData.map((d, i) => (
                      <Cell key={d.name} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#141c25", border: "1px solid #223041", borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {typeData.map((d, i) => (
                <span key={d.name} className="flex items-center gap-1.5 text-[11px] text-[#8ba1b7]">
                  <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />
                  {d.name} · {d.value}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Map */}
        <div className="panel mt-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-[#c6d4e0]">Incident map — Himachal Pradesh</h2>
            <div className="flex flex-wrap items-center gap-3">
              {SEVERITIES.map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-[11px] text-[#8ba1b7]">
                  <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_META[s].hex }} />
                  {s}
                </span>
              ))}
            </div>
          </div>
          {incidents === null ? (
            <div className="flex h-[420px] items-center justify-center rounded-lg border border-[#223041] text-[#4d6275]">
              <Spinner className="h-5 w-5" />
            </div>
          ) : (
            <IncidentMap incidents={filtered.length > 0 || !hasFilters ? filtered : filtered} />
          )}
        </div>

        {/* Filters + table */}
        <div className="panel mt-4 p-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-[#223041] bg-[#0d1218] px-2.5 py-2 text-[12.5px] text-[#c6d4e0]">
              <option value="">All severities</option>
              {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[#223041] bg-[#0d1218] px-2.5 py-2 text-[12.5px] text-[#c6d4e0]">
              <option value="">All types</option>
              {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[#223041] bg-[#0d1218] px-2.5 py-2 text-[12.5px] text-[#c6d4e0]">
              <option value="">All statuses</option>
              <option>Open</option>
              <option>Responding</option>
              <option>Resolved</option>
            </select>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className="rounded-lg border border-[#223041] bg-[#0d1218] px-2.5 py-2 text-[12.5px] text-[#c6d4e0]">
              <option value="">All locations</option>
              {LOCATIONS.map((l) => <option key={l.name}>{l.name}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#4d6275]" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search id, summary, place…"
                className="w-full rounded-lg border border-[#223041] bg-[#0d1218] py-2 pl-8 pr-2.5 text-[12.5px] text-[#c6d4e0] placeholder:text-[#4d6275]"
              />
            </div>
          </div>

          {hasFilters && (
            <div className="mb-3 text-[12px] text-[#8ba1b7]">
              {filtered.length} of {incidents?.length ?? 0} incidents shown
              <button onClick={() => { setSeverity(""); setType(""); setStatus(""); setLocation(""); setQ(""); }} className="ml-3 text-sky-400 hover:underline">
                Clear filters
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#223041] text-[11px] uppercase tracking-wider text-[#4d6275]">
                  <th className="py-2.5 pr-4 font-semibold">ID</th>
                  <th className="py-2.5 pr-4 font-semibold">Location</th>
                  <th className="py-2.5 pr-4 font-semibold">Type</th>
                  <th className="py-2.5 pr-4 font-semibold">Severity</th>
                  <th className="py-2.5 pr-4 font-semibold">Time</th>
                  <th className="py-2.5 pr-4 font-semibold">Status</th>
                  <th className="py-2.5 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {incidents === null ? (
                  <tr><td colSpan={7} className="py-10 text-center text-[#4d6275]"><Spinner className="mx-auto h-5 w-5" /></td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[#8ba1b7]">
                      No incidents match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((i) => (
                    <tr key={i.id} className="border-b border-[#182231] transition hover:bg-[#0d1218]">
                      <td className="py-3 pr-4 font-mono text-[12px] text-sky-300">{i.id}</td>
                      <td className="py-3 pr-4">{i.location}</td>
                      <td className="py-3 pr-4">{i.incident_type}</td>
                      <td className="py-3 pr-4"><SeverityBadge severity={i.severity} /></td>
                      <td className="py-3 pr-4 text-[12px] text-[#8ba1b7]">{timeAgo(i.created_at)}</td>
                      <td className="py-3 pr-4">
                        <select
                          value={i.status}
                          onChange={(e) => setStatusFor(i.id, e.target.value as Incident["status"])}
                          className="rounded-md border border-[#223041] bg-transparent px-1.5 py-1 text-[11.5px] text-[#c6d4e0]"
                          aria-label={`Status for ${i.id}`}
                        >
                          <option>Open</option>
                          <option>Responding</option>
                          <option>Resolved</option>
                        </select>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/report/${i.id}`}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-sky-400 hover:underline"
                        >
                          Report <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-[#4d6275]">
            Status changes persist immediately. Seeded rows are demonstration data.
          </p>
        </div>
      </div>
    </div>
  );
}
