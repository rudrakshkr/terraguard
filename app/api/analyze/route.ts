import { NextRequest, NextResponse } from "next/server";
import { analyzeIncident } from "@/lib/hillsense";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    // Clients must send multipart/form-data (or urlencoded); anything else —
    // e.g. a bare POST with no body — would throw inside formData() and read as
    // a server fault. Fail with a clear client error instead.
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded")) {
      return NextResponse.json(
        { error: "Please add a description, an image, or a voice transcription to analyse." },
        { status: 400 },
      );
    }
    const form = await req.formData();
    const text = String(form.get("text") ?? "").trim();
    const context = String(form.get("context") ?? "").trim(); // structured form fields
    const hazardType = String(form.get("hazard_type") ?? "").trim();
    const lat = Number.parseFloat(String(form.get("lat") ?? ""));
    const lng = Number.parseFloat(String(form.get("lng") ?? ""));
    const file = form.get("image");

    let imageBase64: string | null = null;
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const blob = file as File;
      if (blob.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Image is too large. Please upload one under 6 MB." },
          { status: 413 },
        );
      }
      if (blob.size > 0 && blob.type && !blob.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Unsupported file type. Please upload an image (JPG/PNG/WebP)." },
          { status: 415 },
        );
      }
      const buf = Buffer.from(await blob.arrayBuffer());
      imageBase64 = `data:${blob.type || "image/jpeg"};base64,${buf.toString("base64")}`;
    }

    if (!text && !imageBase64) {
      return NextResponse.json(
        { error: "Please add a description, an image, or a voice transcription to analyse." },
        { status: 400 },
      );
    }

    const result = await analyzeIncident({
      text,
      imageBase64,
      context,
      hazardType: hazardType || undefined,
      location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/analyze]", err);
    return NextResponse.json(
      { error: "Something went wrong while analysing the report. Please try again." },
      { status: 500 },
    );
  }
}
