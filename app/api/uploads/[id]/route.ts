import { NextRequest, NextResponse } from "next/server";
import { getStoredImage, readBlobObject } from "@/lib/avatar-store";

export const runtime = "nodejs";

/**
 * GET — serve a stored image (avatar or report photo).
 *
 * File mode keeps the bytes in the JSON document store; a private Vercel Blob
 * store cannot be read from the browser at all, so those objects are streamed
 * back through here with the server-side SDK. Public-store blobs never hit this
 * route — their CDN URL is used directly.
 *
 * Responses are immutable: ids are content-derived, so changed bytes always
 * produce a different id.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const hit = await getStoredImage(id);
  if (!hit) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const headers = {
    "Content-Type": hit.type,
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  if (hit.kind === "data") {
    const body = hit.data.startsWith("data:")
      ? Buffer.from(hit.data.split(",")[1] ?? "", "base64")
      : Buffer.from(hit.data, "base64");
    return new NextResponse(new Uint8Array(body), { headers });
  }

  const body = await readBlobObject(hit.path, hit.access);
  if (!body) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(body), { headers });
}
