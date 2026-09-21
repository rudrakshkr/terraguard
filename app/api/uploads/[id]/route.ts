import { NextRequest, NextResponse } from "next/server";
import { getAvatar } from "@/lib/avatar-store";

export const runtime = "nodejs";

/**
 * GET — serve a stored avatar image (file mode). Blob-mode avatars are served
 * by the CDN directly and never hit this route. Responses are immutable:
 * avatar ids are content-derived, so a changed photo gets a new id.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const hit = await getAvatar(id);
  if (!hit) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const body = hit.data.startsWith("data:")
    ? Buffer.from(hit.data.split(",")[1] ?? "", "base64")
    : Buffer.from(hit.data, "base64");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": hit.type,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
