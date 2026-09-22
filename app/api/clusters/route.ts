import { NextRequest, NextResponse } from "next/server";
import { listIncidents } from "@/lib/store";
import { detectClusters, haversineKm } from "@/lib/geo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clusters
 *
 * Returns clusters derived only from currently public, active incidents.
 * This endpoint is intentionally public because the service worker caches
 * cluster data as public read-only data.
 *
 * Optional query parameters:
 *   ?lat=<number>&lng=<number>&radius_km=<number>
 */
export async function GET(req: NextRequest) {
  try {
    const incidents = await listIncidents({ public: true });
    let clusters = detectClusters(incidents);

    const lat = Number.parseFloat(req.nextUrl.searchParams.get("lat") ?? "");
    const lng = Number.parseFloat(req.nextUrl.searchParams.get("lng") ?? "");
    const radiusKm = Number.parseFloat(req.nextUrl.searchParams.get("radius_km") ?? "50");

    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusKm) && radiusKm >= 0) {
      clusters = clusters.filter((cluster) =>
        haversineKm(lat, lng, cluster.center.lat, cluster.center.lng) <= radiusKm,
      );
    }

    return NextResponse.json({ clusters });
  } catch (err) {
    console.error("[api/clusters GET]", err);
    return NextResponse.json({ error: "Could not load incident clusters." }, { status: 500 });
  }
}