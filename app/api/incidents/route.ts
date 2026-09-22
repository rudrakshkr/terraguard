import { NextRequest, NextResponse } from "next/server";
import { listIncidents, addIncident } from "@/lib/store";
import { LOCATIONS } from "@/lib/threat";
import { findRelated, haversineKm, fmtDistance } from "@/lib/geo";
import { userFromRequest, publicUser, isOperatorUser } from "@/lib/auth";
import { listComments, commentCountsFor } from "@/lib/community-store";
import type { Incident, Severity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET modes:
 *  - ?public=1               → public nearby feed; no auth required
 *  - ?community_review=1     → signed-in community review queue
 *  - default / ?dashboard=1  → operator-only operational data
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const isPublic = sp.get("public") === "1";
    const isCommunityReview = sp.get("community_review") === "1";

    if (!isPublic) {
      const user = await userFromRequest(req);
      if (!user) {
        return NextResponse.json({ error: "Sign in required." }, { status: 401 });
      }
      if (!isCommunityReview && !isOperatorUser(user)) {
        return NextResponse.json({ error: "Operator access required." }, { status: 403 });
      }
    }

    let incidents = await listIncidents({
      severity: sp.get("severity") ?? undefined,
      type: sp.get("type") ?? undefined,
      status: sp.get("status") ?? undefined,
      location: sp.get("location") ?? undefined,
      q: sp.get("q") ?? undefined,
      public: isPublic,
      communityReview: isCommunityReview,
    });

    if (isPublic) {
      const lat = Number.parseFloat(sp.get("lat") ?? "");
      const lng = Number.parseFloat(sp.get("lng") ?? "");
      const radius = Number.parseFloat(sp.get("radius_km") ?? "50");
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        incidents = incidents
          .map((i) => ({ incident: i, d: haversineKm(lat, lng, i.lat, i.lng) }))
          .filter((r) => r.d <= radius)
          .sort((a, b) => a.d - b.d)
          .map((r) => ({
            ...r.incident,
            distance_km: Math.round(r.d * 10) / 10,
            distance_label: fmtDistance(r.d),
          }));
      }
    }

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
  client_id?: string;
  location?: string;
  lat?: number;
  lng?: number;
  coords_approximate?: boolean;
  description?: string;
  reporter_details?: ReporterDetails;
  image?: { name?: string; type?: string; data?: string } | null;
}

const VALID_TYPES = new Set([
  "Landslide", "Rockfall", "Flood", "Flash Flood", "Road Blockage",
  "Building Damage", "Forest Fire", "Avalanche", "Other",
]);

function buildReportContext(details?: ReporterDetails, location?: string): string {
  const parts: string[] = [];
  if (details?.hazard_type) parts.push(`Hazard type: ${details.hazard_type}`);
  if (details?.when) parts.push(`When: ${details.when}${details.when_exact ? ` (${details.when_exact})` : ""}`);
  if (details?.happening_now) parts.push(`Happening right now: ${details.happening_now}`);
  if (details?.affected?.length) parts.push(`What is affected: ${details.affected.join(", ")}`);
  if (details?.casualties) parts.push(`People trapped/injured/missing: ${details.casualties}`);
  if (details?.observed_severity) parts.push(`Reporter-observed severity: ${details.observed_severity}`);
  if (details?.observations) parts.push(`Additional observations: ${details.observations}`);
  if (location) parts.push(`Location: ${location}`);
  return parts.join("\n");
}

function validCoords(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in with your phone number to report a hazard." },
        { status: 401 },
      );
    }

    const body = (await req.json()) as CreateBody;
    const clientId = typeof body.client_id === "string" ? body.client_id.trim().slice(0, 80) : "";

    if (clientId) {
      const existing = (await listIncidents()).find(
        (i) => i.client_id === clientId && i.reporter_id === user.id,
      );
      if (existing) {
        return NextResponse.json({ incident: existing, related: [], replayed: true }, { status: 200 });
      }
    }

    const description = (body.description ?? "").trim();
    const details = body.reporter_details ?? {};
    const hazardType = (details.hazard_type ?? "").trim();
    if (!VALID_TYPES.has(hazardType)) {
      return NextResponse.json({ error: "Please choose a valid hazard type." }, { status: 400 });
    }
    if (!description && !body.image?.data) {
      return NextResponse.json({ error: "Add a description or photo before submitting." }, { status: 400 });
    }

    const locationText = (body.location ?? "").trim();
    const known = LOCATIONS.find((l) => l.name.toLowerCase() === locationText.toLowerCase());
    const hasRealCoords = validCoords(body.lat, body.lng);
    const lat = hasRealCoords ? body.lat : known?.lat;
    const lng = hasRealCoords ? body.lng : known?.lng;
    const coordsApproximate = hasRealCoords ? body.coords_approximate === true : true;
    if (!validCoords(lat, lng)) {
      return NextResponse.json(
        { error: "A map location is required. Use your current location or choose a known place before submitting." },
        { status: 400 },
      );
    }

    let imageData: string | null = null;
    let photoUrl: string | undefined;
    if (body.image?.data) {
      const imageType = body.image.type ?? "image/jpeg";
      if (!["image/jpeg", "image/png", "image/webp"].includes(imageType)) {
        return NextResponse.json({ error: "Unsupported image type. Use JPG, PNG or WebP." }, { status: 415 });
      }
      imageData = body.image.data;
      const { putReportPhoto } = await import("@/lib/avatar-store");
      const stored = await putReportPhoto(user.id, imageData, imageType);
      if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 413 });
      photoUrl = stored.url;
    }

    const { analyzeIncident } = await import("@/lib/hillsense");
    const result = await analyzeIncident({
      text: description,
      imageBase64: imageData,
      context: buildReportContext(details, locationText),
      hazardType,
      location: { lat: lat as number, lng: lng as number },
    });

    const now = new Date().toISOString();
    const incident = await addIncident({
      created_at: now,
      location: locationText || known?.name || "Unnamed location",
      lat: lat as number,
      lng: lng as number,
      coords_approximate: coordsApproximate,
      incident_type: result.analysis.incident_type,
      severity: result.analysis.severity,
      status: "Open",
      description: description || result.analysis.summary,
      summary: result.analysis.summary,
      confidence: result.analysis.confidence,
      risk_factors: result.analysis.risk_factors,
      immediate_actions: result.analysis.immediate_actions,
      avoid: result.analysis.avoid,
      recommended_response: result.analysis.recommended_response,
      requires_urgent_attention: result.analysis.requires_urgent_attention,
      severity_reasons: result.analysis.severity_reasons,
      needs_verification: result.analysis.needs_verification,
      verification_note: result.analysis.verification_note,
      origin: result.aiAvailable ? "ai" : "manual",
      sources: result.sources.map((s) => ({ title: s.title, doc: s.doc })),
      evidence: result.evidence,
      pipeline: { ...result.timings, saved_at: now },
      status_history: [{ status: "Open", at: now }],
      verification: result.verification.status,
      verification_reasons: result.verification.reasons,
      publication: result.verification.publication,
      reporter_label: "Community report",
      reporter_id: user.id,
      reporter_details: { ...details, hazard_type: hazardType },
      confirmations_yes: 0,
      confirmations_no: 0,
      ...(photoUrl ? { photo_url: photoUrl } : {}),
      ...(clientId ? { client_id: clientId } : {}),
    });

    const related = findRelated(
      { incident_type: incident.incident_type, lat: incident.lat, lng: incident.lng, created_at: incident.created_at },
      await listIncidents(),
      { excludeId: incident.id },
    );
    if (related.length > 0) incident.related_ids = related.map((r) => r.incident.id);

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
