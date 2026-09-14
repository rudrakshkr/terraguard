import type { IncidentType, Severity } from "./types";

export const SEVERITIES: Severity[] = ["Critical", "High", "Moderate", "Low"];

export const SEVERITY_ORDER: Record<Severity, number> = {
  Critical: 4,
  High: 3,
  Moderate: 2,
  Low: 1,
};

export const SEVERITY_META: Record<
  Severity,
  { text: string; bg: string; ring: string; dot: string; hex: string }
> = {
  Critical: {
    text: "text-red-400",
    bg: "bg-red-500/10",
    ring: "ring-red-500/40",
    dot: "bg-red-500",
    hex: "#ef4444",
  },
  High: {
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/40",
    dot: "bg-amber-500",
    hex: "#f59e0b",
  },
  Moderate: {
    text: "text-sky-400",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/40",
    dot: "bg-sky-500",
    hex: "#38bdf8",
  },
  Low: {
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/40",
    dot: "bg-emerald-500",
    hex: "#22c55e",
  },
};

export const STATUS_META: Record<string, { text: string; bg: string; ring: string }> = {
  Open: { text: "text-red-300", bg: "bg-red-500/10", ring: "ring-red-500/30" },
  Responding: { text: "text-amber-300", bg: "bg-amber-500/10", ring: "ring-amber-500/30" },
  Resolved: { text: "text-emerald-300", bg: "bg-emerald-500/10", ring: "ring-emerald-500/30" },
};

export const INCIDENT_TYPES: IncidentType[] = [
  "Landslide",
  "Rockfall",
  "Flood",
  "Flash Flood",
  "Road Blockage",
  "Building Damage",
  "Forest Fire",
  "Avalanche",
  "Other",
];

/** Seeded Himachal Pradesh locations for the map + report form. */
export const LOCATIONS: { name: string; lat: number; lng: number }[] = [
  { name: "Shimla", lat: 31.1048, lng: 77.1734 },
  { name: "Manali", lat: 32.2432, lng: 77.1892 },
  { name: "Kullu", lat: 31.9578, lng: 77.1095 },
  { name: "Mandi", lat: 31.7086, lng: 76.9314 },
  { name: "Chamba", lat: 32.5519, lng: 76.1296 },
  { name: "Dharamshala", lat: 32.219, lng: 76.3234 },
  { name: "Palampur", lat: 32.1106, lng: 76.5403 },
  { name: "Solan", lat: 30.9045, lng: 77.0967 },
];

export function coordsFor(location: string): { lat: number; lng: number } {
  const hit = LOCATIONS.find(
    (l) => l.name.toLowerCase() === location.trim().toLowerCase(),
  );
  // Unknown/custom locations fall back to the Himachal centre of the map.
  return hit ?? { lat: 31.9, lng: 77.1 };
}

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER[s] ?? 0;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
