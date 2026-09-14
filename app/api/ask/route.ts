import { NextRequest, NextResponse } from "next/server";
import { askHillSense } from "@/lib/hillsense";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { question?: string };
    const question = (body.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "Please type a question first." }, { status: 400 });
    }
    const result = await askHillSense(question);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/ask]", err);
    return NextResponse.json(
      { error: "Something went wrong while answering. Please try again." },
      { status: 500 },
    );
  }
}
