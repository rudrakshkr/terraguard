import { NextResponse } from "next/server";
import { listIncidents } from "@/lib/store";
import { detectClusters } from "@/lib/geo";

export const runtime = "nodejs";

export async function GET() {
  try {
    const incidents = await listIncidents();
    return NextResponse.json({ clusters: detectClusters(incidents) });
  } catch (err) {
    console.error("[api/clusters]", err);
    return NextResponse.json({ clusters: [] }, { status: 200 });
  }
}
