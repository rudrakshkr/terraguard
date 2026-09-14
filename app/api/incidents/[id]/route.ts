import { NextRequest, NextResponse } from "next/server";
import { getIncident, updateStatus } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const incident = await getIncident(id);
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    return NextResponse.json({ incident });
  } catch (err) {
    console.error("[api/incidents/:id GET]", err);
    return NextResponse.json({ error: "Could not load the incident." }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: string };
    const status = body.status;
    if (status !== "Open" && status !== "Responding" && status !== "Resolved") {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    const updated = await updateStatus(id, status);
    if (!updated) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    return NextResponse.json({ incident: updated });
  } catch (err) {
    console.error("[api/incidents/:id PATCH]", err);
    return NextResponse.json({ error: "Could not update the incident." }, { status: 500 });
  }
}
