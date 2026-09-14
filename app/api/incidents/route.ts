import { NextRequest, NextResponse } from "next/server";
import { listIncidents, addIncident } from "@/lib/store";
import { coordsFor } from "@/lib/threat";
import type { IncidentAnalysis, Incident, Severity } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const incidents = await listIncidents({
      severity: sp.get("severity") ?? undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      location: sp.get("location") ?? undefined,
      q: sp.get("q") ?? undefined,
    });
    return NextResponse.json({ incidents });
  } catch (err) {
    console.error("[api/incidents GET]", err);
    return NextResponse.json({ error: "Could not load incidents." }, { status: 500 });
  }
}

interface CreateBody {
  location?: string;
  lat?: number;
  lng?: number;
  description?: string;
  analysis?: IncidentAnalysis;
  aiAvailable?: boolean;
  sources?: { title: string }[];
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    const a = body.analysis;
    if (!a || !a.incident_type || !a.severity) {
      return NextResponse.json({ error: "A completed analysis is required to save an incident." }, { status: 400 });
    }
    const location = (body.location ?? "").trim() || "Unnamed location";
    const fallback = coordsFor(location);

    const incident = await addIncident({
      created_at: new Date().toISOString(),
      location,
      lat: typeof body.lat === "number" ? body.lat : fallback.lat,
      lng: typeof body.lng === "number" ? body.lng : fallback.lng,
      incident_type: a.incident_type,
      severity: a.severity,
      status: "Open",
      description: (body.description ?? "").trim() || a.summary,
      summary: a.summary,
      confidence: a.confidence,
      risk_factors: a.risk_factors,
      immediate_actions: a.immediate_actions,
      avoid: a.avoid,
      recommended_response: a.recommended_response,
      requires_urgent_attention: a.requires_urgent_attention,
      origin: body.aiAvailable ? "ai" : "manual",
      sources: body.sources ?? [],
    });
    return NextResponse.json({ incident }, { status: 201 });
  } catch (err) {
    console.error("[api/incidents POST]", err);
    return NextResponse.json({ error: "Could not save the incident." }, { status: 500 });
  }
}

export type { Incident, Severity };
