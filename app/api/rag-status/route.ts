import { NextResponse } from "next/server";
import { storeInfo } from "@/lib/rag";

export const runtime = "nodejs";

export async function GET() {
  try {
    const info = await storeInfo();
    return NextResponse.json(info);
  } catch (err) {
    console.error("[api/rag-status]", err);
    return NextResponse.json(
      { docs: 0, chunks: 0, embedder: "local", aiAvailable: false, error: true },
      { status: 200 },
    );
  }
}
