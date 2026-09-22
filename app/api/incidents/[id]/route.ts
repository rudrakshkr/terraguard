import { NextRequest, NextResponse } from "next/server";
import { getIncident, confirmIncident, updateStatus } from "@/lib/store";
import {
  hasConfirmed,
  recordConfirmation,
  confirmationCounts,
  latestConfirmationAt,
  listComments,
  addComment,
  deleteComment,
  withAuthorProfiles,
  hasLikedComment,
  toggleCommentLike,
  likeCountsFor,
} from "@/lib/community-store";
import { userFromRequest, getUserById, isOperatorUser } from "@/lib/auth";
import { persistenceConfigError } from "@/lib/kv";
import { canConfirmHazard } from "@/lib/community-policy";

export const runtime = "nodejs";
// Never cache: incidents and community data must be live across all clients.
export const dynamic = "force-dynamic";

export async function GET(
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
    const publicIncident = incident.publication === "public";
    if (!publicIncident && !user) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }

  const rawComments = await listComments(id);    const likeCounts = await likeCountsFor(rawComments);
    // Load the current user's like state for the visible comments in one batch.
    const myLikes = user
      ? (await Promise.allSettled(
          rawComments.map((c) => hasLikedComment(c.id, user.id)),
        )).map((r) => (r.status === "fulfilled" ? r.value : null))
      : [];

    const nameCache = new Map<string, string>();
    const avatarCache = new Map<string, string | null>();
    const authorIds = [...new Set(rawComments.map((c) => c.user_id))];
    for (const uid of authorIds) {
      const u = await getUserById(uid);
      nameCache.set(uid, u?.display_name || "HillSense user");
      avatarCache.set(uid, u?.avatar_url ?? null);
    }
    const comments = withAuthorProfiles(rawComments, (uid) => ({
      display_name: nameCache.get(uid) ?? "HillSense user",
      avatar_url: avatarCache.get(uid) ?? null,
    })).map((c, idx) => ({
      ...c,
      like_count: likeCounts[c.id] ?? 0,
      liked_by_me: user ? (myLikes[idx] ?? false) : false,
    }));

    const mine = user ? await hasConfirmed(id, user.id) : null;
    const lastCommunityAt = await latestConfirmationAt(id);

    return NextResponse.json({
      incident,
      comments,
      my_confirmation: mine ? { response: mine.response, at: mine.at } : null,
      last_community_confirmation_at: lastCommunityAt,
    });
  } catch (err) {
    console.error("[api/incidents/:id GET]", err);
    return NextResponse.json({ error: "Could not load the incident." }, { status: 500 });
  }
}

/**
 * POST — authenticated community actions on an incident:
 *   { action: "confirm", response: "yes" | "no" }  → one-per-user confirmation
 *   { action: "comment", body: string }             → add a community comment
 *   { action: "like", comment_id: string }          → toggle comment like
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  // Confirmations/comments are durable community records — refuse clearly
  // when the deployment cannot persist them.
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

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
      action?: "confirm" | "comment" | "like";
      response?: "yes" | "no";
      comment_id?: string;
      confirmed?: boolean; // legacy shape
      body?: string;
      client_id?: string; // offline-outbox idempotency key
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

      // Reporter independence: nobody can corroborate the incident they
      // reported themselves. Enforced here (not only in the UI) so a direct
      // API call cannot bypass it.
      const decision = canConfirmHazard(incident, user.id);
      if (!decision.allowed) {
        return NextResponse.json(
          { error: decision.reason, code: decision.code },
          { status: decision.status },
        );
      }

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
                ? "You already observed that this hazard is still present."
                : "You already reported this hazard as no longer present.",
          },
          { status: 200 },
        );
      }

      // For an unpublished report, the reporter's own vote does not count as
      // independent community corroboration. Other users can collectively
      // publish an AI-needs-review report with enough first-hand confirmations.
      const counts = await confirmationCounts(id, { excludeUserId: incident.reporter_id });
      const updated = await confirmIncident(id, response === "yes", counts);
      if (!updated) {
        return NextResponse.json({ error: "Incident not found." }, { status: 404 });
      }
      const communityPublished =
        incident.publication === "review_only" &&
        updated.publication === "public";

      return NextResponse.json({
        incident: updated,
        my_confirmation: { response: record.response, at: record.at },
        published: communityPublished,
        message: communityPublished
          ? "This report has been published after independent community corroboration."
          : response === "yes"
            ? "Thanks — your observation was recorded."
            : "Thanks — your update was recorded. One response per person is counted.",
      });
    }

    /* -------------------------------- comments ------------------------------- */
    if (body.action === "comment") {
      const result = await addComment(
        id,
        user.id,
        user.display_name || "HillSense user",
        body.body ?? "",
        typeof body.client_id === "string" && body.client_id.trim() ? body.client_id.trim().slice(0, 80) : undefined,
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      const comment = withAuthorProfiles([result.comment], () => ({
        display_name: user.display_name || "HillSense user",
        avatar_url: user.avatar_url ?? null,
      }))[0];
      return NextResponse.json({ comment, like_count: 0, liked_by_me: false }, { status: 201 });
    }

    /* ------------------------------- comment likes ----------------------------- */
    if (body.action === "like") {
      if (!user) {
        return NextResponse.json({ error: "Please sign in to react to comments." }, { status: 401 });
      }
      const result = await toggleCommentLike(
        body.comment_id ?? "",
        user.id,
        typeof body.client_id === "string" && body.client_id.trim() ? body.client_id.trim().slice(0, 80) : undefined,
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json(
        { liked: result.liked, count: result.count },
        { status: 200 },
      );
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    console.error("[api/incidents/:id POST]", err);
    return NextResponse.json({ error: "Could not process your request." }, { status: 500 });
  }
}

/**
 * PATCH — update an incident's operational status (Open | Responding | Resolved).
 * Used by the Command Center table; accepts both { status } (current client) and
 * { new_status } (legacy). Returns the updated incident or 400/404 on bad input.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Sign in required to update incident status." }, { status: 401 });
    }
    if (!isOperatorUser(user)) {
      return NextResponse.json({ error: "Operator access required to update incident status." }, { status: 403 });
    }
    const { id } = await ctx.params;
    const body = (await req.json()) as { status?: string; new_status?: string };
    const next = body.status ?? body.new_status;
    if (next !== "Open" && next !== "Responding" && next !== "Resolved") {
      return NextResponse.json(
        { error: "Invalid status. Use Open, Responding or Resolved." },
        { status: 400 },
      );
    }
    const incident = await getIncident(id);
    if (!incident) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    if (incident.status === next) {
      return NextResponse.json({ incident }); // no-op — return current state
    }
    const now = new Date().toISOString();
    const history = [...(incident.status_history ?? [{ status: incident.status, at: incident.created_at }])];
    if (history[history.length - 1]?.status !== next) {
      history.push({ status: next, at: now });
    }
    const updated = await updateStatus(id, next, history);
    if (!updated) {
      return NextResponse.json({ error: "Incident not found." }, { status: 404 });
    }
    return NextResponse.json({ incident: updated });
  } catch (err) {
    console.error("[api/incidents/:id PATCH]", err);
    return NextResponse.json({ error: "Could not update the incident status." }, { status: 500 });
  }
}

/** DELETE /api/incidents/:id?comment_id=… — delete your own comment. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

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