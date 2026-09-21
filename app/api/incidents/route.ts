import { NextRequest, NextResponse } from "next/server";
import { listIncidents, addIncident } from "@/lib/store";
import { LOCATIONS } from "@/lib/threat";
import { findRelated, haversineKm, fmtDistance } from "@/lib/geo";
import { userFromRequest, publicUser } from "@/lib/auth";
import { listComments, commentCountsFor } from "@/lib/community-store";
import type { IncidentAnalysis, Incident, Severity } from "@/lib/types";

export const runtime = "nodejs";
// Never cache: incidents and community data must be live across all clients.
export const dynamic = "force-dynamic";

/**
 * GET — dashboard mode (default) or public nearby mode (?public=1&lat=&lng=&radius_km=).
 * Nearby mode returns only verified, published, active incidents, each annotated
 * with `distance_km` / `distance_label` relative to the requester.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const isPublic = sp.get("public") === "1";
    let incidents = await listIncidents({
      severity: sp.get("severity") ?? undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      location: sp.get("location") ?? undefined,
      q: sp.get("q") ?? undefined,
      public: isPublic,
    });
    if (isPublic) {
      const lat = Number.parseFloat(sp.get("lat") ?? "");
      const lng = Number.parseFloat(sp.get("lng") ?? "");
      const radius = Number.parseFloat(sp.get("radius_km") ?? "50");
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        incidents = incidents
          .map((i) => ({
            incident: i,
            d: haversineKm(lat, lng, i.lat, i.lng),
          }))
          .filter((r) => r.d <= radius)
          .sort((a, b) => a.d - b.d)
          .map((r) => ({
            ...r.incident,
            distance_km: Math.round(r.d * 10) / 10,
            distance_label: fmtDistance(r.d),
          }));
      }
    }
    // Comment counts annotate the feed so cards can show real activity
    // without the client making one request per incident.
    const withCounts = await commentCountsFor(incidents);
    const annotated = incidents.map((i) => ({
      ...i,
      comment_count: withCounts[i.id] ?? 0,
    }));
    return NextResponse.json({ incidents: annotated });
  } catch (err) {
    console.error("[api/incidents GET]", err);
    return NextResponse.json({ error: "Could not load incidents." }, { status: 500 });
  }
}

interface ReporterDetails {
  hazard_type?: string;
  when?: string;
  when_exact?: string;
  happening_now?: string;
  affected?: string[];
  casualties?: string;
  observed_severity?: string;
  observations?: string;
}

interface CreateBody {
  location?: string;
  lat?: number;
  lng?: number;
  coords_approximate?: boolean;
  description?: string;
  reporter_details?: ReporterDetails;
  analysis?: IncidentAnalysis;
  aiAvailable?: boolean;
  sources?: { title: string; doc?: string }[];
  evidence?: Incident["evidence"];
  pipeline?: Incident["pipeline"];
  verification?: Incident["verification"];
  verification_reasons?: string[];
  publication?: Incident["publication"];
}

export async function POST(req: NextRequest) {
  try {
    // Only authenticated users can create reports.
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in with your phone number to report a hazard." },
        { status: 401 },
      );
    }

    const body = (await req.json()) as CreateBody;
    const a = body.analysis;
    if (!a || !a.incident_type || !a.severity) {
      return NextResponse.json({ error: "A completed analysis is required to save an incident." }, { status: 400 });
    }
    const location = (body.location ?? "").trim() || "Unnamed location";
    const known = LOCATIONS.some((l) => l.name.toLowerCase() === location.toLowerCase());
    const hasRealCoords =
      typeof body.lat === "number" &&
      typeof body.lng === "number" &&
      Number.isFinite(body.lat) &&
      Number.isFinite(body.lng);
    const coordsApproximate = body.coords_approximate ?? (!known && !hasRealCoords);

    const now = new Date().toISOString();
    const incident = await addIncident({
      created_at: now,
      location,
      lat: hasRealCoords ? (body.lat as number) : 31.9,
      lng: hasRealCoords ? (body.lng as number) : 77.1,
      coords_approximate: coordsApproximate,
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
      severity_reasons: a.severity_reasons,
      needs_verification: a.needs_verification,
      verification_note: a.verification_note,
      origin: body.aiAvailable ? "ai" : "manual",
      sources: body.sources ?? [],
      evidence: body.evidence ?? [],
      pipeline: { totalMs: body.pipeline?.totalMs ?? 0, ...body.pipeline, saved_at: now },
      status_history: [{ status: "Open", at: now }],
      verification: body.verification ?? "needs_review",
      verification_reasons: body.verification_reasons ?? [],
      publication: body.publication ?? "review_only",
      reporter_label: "Community report",
      reporter_id: user.id,
      last_confirmed_at: now,
      confirmations_yes: 0,
      confirmations_no: 0,
    });

    // Duplicate/related detection against existing active incidents.
    const related = findRelated(
      { incident_type: incident.incident_type, lat: incident.lat, lng: incident.lng, created_at: incident.created_at },
      await listIncidents(),
      { excludeId: incident.id },
    );

    // Optionally link the new report into a corroborated group.
    if (related.length > 0) {
      incident.related_ids = related.map((r) => r.incident.id);
    }

    const firstComment = await listComments(incident.id);
    return NextResponse.json(
      { incident, related, user: publicUser(user), comments: firstComment },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/incidents POST]", err);
    return NextResponse.json({ error: "Could not save the incident." }, { status: 500 });
  }
}

export type { Incident, Severity };
