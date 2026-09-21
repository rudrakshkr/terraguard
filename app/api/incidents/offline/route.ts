import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, publicUser } from "@/lib/auth";
import { addIncident, listIncidents } from "@/lib/store";
import { findRelated } from "@/lib/geo";
import { analyzeIncident } from "@/lib/hillsense";
import { putReportPhoto } from "@/lib/avatar-store";
import { listComments, commentCountsFor } from "@/lib/community-store";
import type { Incident } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const VALID_TYPES = new Set([
  "Landslide", "Rockfall", "Flood", "Flash Flood", "Road Blockage",
  "Building Damage", "Forest Fire", "Avalanche", "Other",
]);

interface OfflineReportPayload {
  client_id?: string;
  description?: string;
  hazard_type?: string;
  reporter_details?: Incident["reporter_details"];
  location_text?: string;
  lat?: number;
  lng?: number;
  coords_approximate?: boolean;
  address_verified?: boolean;
  photo?: { name?: string; type?: string; data: string } | null;
  saved_at?: string;
}

/**
 * POST — ingest a report that was created offline and queued on the device.
 *
 * Contract with lib/sync.ts:
 *  - body carries `client_id` (the outbox idempotency key) plus the saved
 *    offline payload (raw GPS coords, optional photo data URL, reporter
 *    details, saved_at).
 *  - 201 → stored normally (analysis + verification ran server-side).
 *  - 200 → already ingested under this client_id (replay) → the sync engine
 *    treats any 2xx/409 as done.
 *  - 400/413/415 → permanently rejected (validation) — sync marks failed.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in with your phone number to submit this report." },
        { status: 401 },
      );
    }

    const body = (await req.json()) as OfflineReportPayload & { client_id?: string };
    const clientId = (body.client_id ?? "").trim();

    // ---- replay protection: same client_id → return the original incident ----
    if (clientId) {
      const existing = (await listIncidents()).find(
        (i) => (i as { client_id?: string }).client_id === clientId,
      );
      if (existing) {
        const comments = await listComments(existing.id);
        return NextResponse.json({ incident: existing, comments, replayed: true });
      }
    }

    // ---- validation (mirror the online create rules) ----
    const hazardType = (body.hazard_type ?? "").trim();
    const description = (body.description ?? "").trim();
    if (!VALID_TYPES.has(hazardType)) {
      return NextResponse.json({ error: "Unknown hazard type in the saved report." }, { status: 400 });
    }
    if (!description && !body.photo?.data) {
      return NextResponse.json({ error: "The saved report has no description or photo." }, { status: 400 });
    }

    // ---- photo: reuse the existing upload store (Vercel Blob / file mode) ----
    let photoUrl: string | undefined;
    if (body.photo?.data) {
      const type = body.photo.type && body.photo.type.startsWith("image/") ? body.photo.type : "image/jpeg";
      const result = await putReportPhoto(user.id, body.photo.data, type);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 415 });
      }
      photoUrl = result.url;
    }

    const lat = Number.isFinite(body.lat) ? (body.lat as number) : undefined;
    const lng = Number.isFinite(body.lng) ? (body.lng as number) : undefined;

    // ---- run the REAL pipeline server-side: classify → retrieve → ground → verify ----
    // The offline client never fakes this; "Pending AI verification" on the
    // device becomes a real AI CHECK PASSED / NEEDS REVIEW / NOT PUBLISHED here.
    const text = [description, body.location_text ? `Location: ${body.location_text}` : ""].filter(Boolean).join("\n\n");
    const result = await analyzeIncident({
      text,
      imageBase64: body.photo?.data ?? null,
      context: "", // structured details are appended below
      hazardType,
      location: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    });

    const location = (body.location_text ?? "").trim() || "Unnamed location";
    const now = new Date().toISOString();

    const incident = await addIncident({
      created_at: body.saved_at ?? now,
      location,
      lat: lat ?? 31.9,
      lng: lng ?? 77.1,
      coords_approximate: body.coords_approximate ?? !(lat !== undefined && lng !== undefined),
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
      pipeline: { totalMs: result.timings.totalMs, saved_at: now },
      status_history: [{ status: "Open", at: now }],
      verification: result.verification.status,
      verification_reasons: result.verification.reasons,
      publication: result.verification.publication,
      reporter_label: "Community report",
      reporter_id: user.id,
      reporter_details: {
        ...(body.reporter_details ?? {}),
        hazard_type: hazardType,
      },
      last_confirmed_at: now,
      confirmations_yes: 0,
      confirmations_no: 0,
      photo_url: photoUrl,
      client_id: clientId || undefined,
    });

    // Duplicate/related detection against existing active incidents.
    const related = findRelated(
      {
        incident_type: incident.incident_type,
        lat: incident.lat,
        lng: incident.lng,
        created_at: incident.created_at,
      },
      await listIncidents(),
      { excludeId: incident.id },
    );
    if (related.length > 0) {
      incident.related_ids = related.map((r) => r.incident.id);
    }

    const withCounts = await commentCountsFor([incident]);
    const annotated = { ...incident, comment_count: withCounts[incident.id] ?? 0 };

    return NextResponse.json(
      { incident: annotated, related, user: publicUser(user), comments: await listComments(incident.id) },
      { status: 201 },
    );
  } catch (err) {
    console.error("[api/incidents/offline]", err);
    return NextResponse.json({ error: "Could not process the saved report. Will retry." }, { status: 500 });
  }
}
