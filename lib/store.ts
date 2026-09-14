/**
 * Tiny JSON-file persistence for incidents (demo-grade, no external DB).
 * Safe for the single-user demo workload this app targets.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { seedIncidents } from "./seed-incidents";
import type { Incident, IncidentFilters } from "./types";

const DATA_PATH = path.join(process.cwd(), ".hillsense-incidents.json");

let cache: Incident[] | null = null;

async function load(): Promise<Incident[]> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await fs.readFile(DATA_PATH, "utf8")) as Incident[];
    if (Array.isArray(raw)) {
      cache = raw;
      return cache;
    }
  } catch {
    /* first boot — seed below */
  }
  cache = seedIncidents();
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(cache, null, 2));
  } catch {
    /* persistence best-effort */
  }
  return cache;
}

async function persist(list: Incident[]): Promise<void> {
  cache = list;
  try {
    await fs.writeFile(DATA_PATH, JSON.stringify(list, null, 2));
  } catch {
    /* persistence best-effort */
  }
}

export async function listIncidents(f: IncidentFilters = {}): Promise<Incident[]> {
  let list = await load();
  if (f.severity) list = list.filter((i) => i.severity === f.severity);
  if (f.type) list = list.filter((i) => i.incident_type === f.type);
  if (f.status) list = list.filter((i) => i.status === f.status);
  if (f.location)
    list = list.filter(
      (i) => i.location.toLowerCase() === f.location!.trim().toLowerCase(),
    );
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(
      (i) =>
        i.description.toLowerCase().includes(q) ||
        i.summary.toLowerCase().includes(q) ||
        i.location.toLowerCase().includes(q),
    );
  }
  return [...list].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function getIncident(id: string): Promise<Incident | null> {
  const list = await load();
  return list.find((i) => i.id === id) ?? null;
}

export async function addIncident(input: Omit<Incident, "id">): Promise<Incident> {
  const list = await load();
  const maxNum = list.reduce((m, i) => {
    const n = Number.parseInt(i.id.replace("HS-", ""), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  const incident: Incident = { ...input, id: `HS-${maxNum + 1}` };
  await persist([incident, ...list]);
  return incident;
}

export async function updateStatus(
  id: string,
  status: Incident["status"],
): Promise<Incident | null> {
  const list = await load();
  const idx = list.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  const updated = { ...list[idx], status };
  const next = [...list];
  next[idx] = updated;
  await persist(next);
  return updated;
}

export function nextIncidentId(): string {
  return `HS-${Date.now().toString(36)}`;
}
