import type { Incident } from "./types";

/** Great-circle distance in km. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function fmtDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

export function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

export function fmtAge(mins: number): string {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export type Freshness = "fresh" | "recent" | "stale";

/** Public freshness classification drives both badges and reconfirmation prompts. */
export function freshnessOf(incident: Incident): Freshness {
  const last = incident.last_confirmed_at ?? incident.created_at;
  const mins = minutesSince(last);
  if (mins <= 60) return "fresh";
  if (mins <= 24 * 60) return "recent";
  return "stale";
}

export function needsReconfirmation(incident: Incident): boolean {
  return freshnessOf(incident) === "stale" && incident.status !== "Resolved";
}

/**
 * Related-report detection: same (or sibling) hazard type within a
 * spatio-temporal window. Used to link duplicate community reports.
 */
const TYPE_SIBLINGS: Record<string, string[]> = {
  Landslide: ["Landslide", "Road Blockage"],
  "Road Blockage": ["Road Blockage", "Landslide"],
  Rockfall: ["Rockfall", "Road Blockage"],
  "Flash Flood": ["Flash Flood", "Flood"],
  Flood: ["Flood", "Flash Flood"],
};

export function findRelated(
  incident: { incident_type: string; lat: number; lng: number; created_at: string },
  pool: Incident[],
  opts: { maxKm?: number; maxMins?: number; excludeId?: string } = {},
): { incident: Incident; distanceKm: number; minutesApart: number }[] {
  const maxKm = opts.maxKm ?? 10;
  const maxMins = opts.maxMins ?? 24 * 60;
  const t = new Date(incident.created_at).getTime();
  const siblings = TYPE_SIBLINGS[incident.incident_type] ?? [incident.incident_type];

  return pool
    .filter((p) => p.id !== opts.excludeId)
    .filter((p) => p.status !== "Resolved")
    .filter((p) => siblings.includes(p.incident_type))
    .map((p) => ({
      incident: p,
      distanceKm: haversineKm(incident.lat, incident.lng, p.lat, p.lng),
      minutesApart: Math.abs(t - new Date(p.created_at).getTime()) / 60000,
    }))
    .filter((r) => r.distanceKm <= maxKm && r.minutesApart <= maxMins)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 3);
}

export interface HazardCluster {
  id: string;
  label: string; // e.g. "Kullu–Mandi corridor"
  center: { lat: number; lng: number };
  incidents: Incident[];
  types: { type: string; count: number }[];
  windowMins: number;
  firstAt: string;
  lastAt: string;
}

const CORRIDOR_HINTS: { test: (loc: string) => boolean; label: string }[] = [
  { test: (l) => /kullu|manali|mandi/i.test(l), label: "Kullu–Mandi corridor" },
  { test: (l) => /shimla|solan/i.test(l), label: "Shimla–Solan sector" },
  { test: (l) => /chamba|dharamshala|palampur/i.test(l), label: "Chamba–Kangra belt" },
];

function corridorLabel(locations: string[]): string {
  for (const h of CORRIDOR_HINTS) if (locations.some(h.test)) return h.label;
  return "Himachal Pradesh";
}

/**
 * AI-detected incident clusters: ≥3 active incidents of related hazard types
 * within 25 km and a 12-hour window. Descriptive, not predictive.
 */
export function detectClusters(incidents: Incident[]): HazardCluster[] {
  const active = incidents.filter((i) => i.status !== "Resolved");
  const used = new Set<string>();
  const clusters: HazardCluster[] = [];

  const sorted = [...active].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  for (const seed of sorted) {
    if (used.has(seed.id)) continue;
    const group = sorted.filter(
      (c) =>
        !used.has(c.id) &&
        haversineKm(seed.lat, seed.lng, c.lat, c.lng) <= 25 &&
        Math.abs(new Date(seed.created_at).getTime() - new Date(c.created_at).getTime()) <= 12 * 3600_000,
    );
    if (group.length < 3) continue;

    group.forEach((g) => used.add(g.id));
    const types = new Map<string, number>();
    for (const g of group) types.set(g.incident_type, (types.get(g.incident_type) ?? 0) + 1);
    const times = group.map((g) => new Date(g.created_at).getTime()).sort((a, b) => a - b);

    clusters.push({
      id: `cluster-${seed.id}`,
      label: corridorLabel(group.map((g) => g.location)),
      center: {
        lat: group.reduce((s, g) => s + g.lat, 0) / group.length,
        lng: group.reduce((s, g) => s + g.lng, 0) / group.length,
      },
      incidents: group,
      types: [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      windowMins: Math.round((times[times.length - 1] - times[0]) / 60000),
      firstAt: new Date(times[0]).toISOString(),
      lastAt: new Date(times[times.length - 1]).toISOString(),
    });
  }
  return clusters.sort((a, b) => b.incidents.length - a.incidents.length);
}
