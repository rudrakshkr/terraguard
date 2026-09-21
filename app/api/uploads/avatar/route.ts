import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { putAvatar, MAX_AVATAR_BYTES, ALLOWED_IMAGE_TYPES } from "@/lib/avatar-store";

export const runtime = "nodejs";

/**
 * POST — upload the caller's profile photo (multipart form field "file").
 * The image is downscaled client-side before upload; the server re-validates
 * type and size. Returns { url } to save via the profile endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Send the photo as multipart form data." }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No photo was attached." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported image type. Use JPG, PNG or WebP." }, { status: 415 });
    }
    if (file.size > MAX_AVATAR_BYTES * 1.34) {
      // base64 headroom; putAvatar re-checks the decoded size precisely.
      return NextResponse.json({ error: "Image is too large. Please choose one under 2 MB." }, { status: 413 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${buf.toString("base64")}`;
    const result = await putAvatar(user.id, dataUrl, file.type);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ url: result.url }, { status: 201 });
  } catch (err) {
    console.error("[uploads/avatar]", err);
    return NextResponse.json({ error: "Could not upload the photo. Please try again." }, { status: 500 });
  }
}
