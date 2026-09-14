import type { Severity } from "./types";

export const SEVERITIES: Severity[] = ["Critical", "High", "Moderate", "Low"];

export const INCIDENT_TYPES = [
  "Landslide",
  "Rockfall",
  "Flood",
  "Flash Flood",
  "Road Blockage",
  "Building Damage",
  "Forest Fire",
  "Avalanche",
  "Other",
] as const;

export const LOCATIONS = [
  { name: "Shimla", lat: 31.1048, lng: 77.1734 },
  { name: "Manali", lat: 32.2432, lng: 77.1892 },
  { name: "Kullu", lat: 31.9578, lng: 77.1095 },
  { name: "Mandi", lat: 31.7086, lng: 76.9314 },
  { name: "Chamba", lat: 32.5519, lng: 76.1296 },
  { name: "Dharamshala", lat: 32.219, lng: 76.3234 },
  { name: "Palampur", lat: 32.1106, lng: 76.5403 },
  { name: "Solan", lat: 30.9045, lng: 77.0967 },
];

/**
 * Interpret the raw model score as a band. We deliberately do NOT present the
 * LLM's self-reported number as a calibrated probability.
 */
export function confidenceBand(n: number): "High" | "Medium" | "Low" {
  if (n >= 0.8) return "High";
  if (n >= 0.6) return "Medium";
  return "Low";
}

/** Visible provenance metadata for the three origins. */
export const ORIGIN_META: Record<string, { label: string; title: string }> = {
  seed: { label: "DEMO DATA", title: "Seeded demonstration incident — not a live report" },
  ai: { label: "NEW COMMUNITY REPORT", title: "Submitted by a community member through HillSense" },
  manual: { label: "COMMUNITY REPORT", title: "Manually recorded incident" },
};

export function originMeta(origin: string) {
  return ORIGIN_META[origin] ?? ORIGIN_META.manual;
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
