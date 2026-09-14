import { NextRequest, NextResponse } from "next/server";
import { getIncident, confirmIncident } from "@/lib/store";
import {
  hasConfirmed,
  recordConfirmation,
  confirmationCounts,
  listComments,
  addComment,
  deleteComment,
} from "@/lib/community-store";
import { userFromRequest, getUserById } from "@/lib/auth";

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

    // Comments are public observations, shown to everyone on the detail page.
    // Phone numbers/private info never enter comment records, so this is safe.
    const comments = listComments(id);

    // If the caller is authenticated, tell them whether they already responded
    // so the UI can show the completed state after a refresh.
    const user = await userFromRequest(_req);
    const mine = user ? hasConfirmed(id, user.id) : null;

    return NextResponse.json({
      incident,
      comments,
      my_confirmation: mine ? { response: mine.response, at: mine.at } : null,
    });
  } catch (err) {
    console.error("[api/incidents/:id GET]", err);
    return NextResponse.json({ error: "Could not load the incident." }, { status: 500 });
  }
}

/**
 * POST — two authenticated actions:
 *   { action: "confirm", response: "yes" | "no" }  → one-per-user confirmation
 *   { action: "comment", body: string }            → add a community comment
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const incident = await getIncident(id);
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { error: "Please sign in with your phone number to respond to hazards." },
        { status: 401 },
      );
    }

    const body = (await req.json()) as {
      action?: string;
      response?: string;
      confirmed?: boolean; // legacy shape
      body?: string;
    };

    /* ------------------------------ confirmations ----------------------------- */
    if (body.action === "confirm" || typeof body.confirmed === "boolean") {
      const response: "yes" | "no" =
        body.action === "confirm"
          ? body.response === "yes"
            ? "yes"
            : "no"
          : body.confirmed
            ? "yes"
            : "no";

      const { record, already } = await recordConfirmation(id, user.id, response);

      if (already) {
        // Server-enforced one-response-per-user: nothing mutated, explain politely.
        return NextResponse.json(
          {
            already_confirmed: true,
            my_confirmation: { response: record.response, at: record.at },
            incident,
            message:
              record.response === "yes"
                ? "You already confirmed this hazard is still present."
                : "You already reported this hazard as cleared.",
          },
          { status: 200 },
        );
      }

      const counts = confirmationCounts(id);
      const updated = await confirmIncident(id, response === "yes", counts);
      if (!updated) {
        return NextResponse.json({ error: "Incident not found." }, { status: 404 });
      }
      return NextResponse.json({
        incident: updated,
        my_confirmation: { response: record.response, at: record.at },
        message:
          response === "yes"
            ? "Thanks. Your confirmation was recorded."
            : "Thanks. Your update was recorded.",
      });
    }

    /* -------------------------------- comments ------------------------------- */
    if (body.action === "comment") {
      const result = await addComment(id, user.id, user.display_name || "HillSense user", body.body ?? "");
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ comment: result.comment }, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("[api/incidents/:id POST]", err);
    return NextResponse.json({ error: "Could not process your request." }, { status: 500 });
  }
}

/** DELETE /api/incidents/:id?comment_id=… — delete your own comment. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    await ctx.params; // incident id not strictly needed, comment id is authoritative
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const commentId = req.nextUrl.searchParams.get("comment_id");
    if (!commentId) {
      return NextResponse.json({ error: "comment_id is required." }, { status: 400 });
    }
    // Double-check ownership via the user record (guards stale sessions).
    const owner = await getUserById(user.id);
    if (!owner) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const ok = await deleteComment(commentId, user.id);
    if (!ok) {
      return NextResponse.json({ error: "Comment not found, or it isn't yours." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/incidents/:id DELETE]", err);
    return NextResponse.json({ error: "Could not delete the comment." }, { status: 500 });
  }
}
