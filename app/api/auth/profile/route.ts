import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, updateUser, publicUser } from "@/lib/auth";
import { persistenceConfigError } from "@/lib/kv";
import { deleteAvatarByUrl } from "@/lib/avatar-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProfileLocation {
  full_address?: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  lat?: number;
  lng?: number;
  approximate?: boolean;
}

interface ProfileBody {
  display_name?: unknown;
  email?: unknown;
  avatar_url?: unknown;
  location?: unknown;
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function sanitizeLocation(value: unknown): ProfileLocation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const l = value as Record<string, unknown>;

  const lat =
    typeof l.lat === "number" && Number.isFinite(l.lat) && Math.abs(l.lat) <= 90
      ? l.lat
      : undefined;

  const lng =
    typeof l.lng === "number" && Number.isFinite(l.lng) && Math.abs(l.lng) <= 180
      ? l.lng
      : undefined;

  const pincodeRaw = cleanString(l.pincode, 10);
  const pincode = pincodeRaw.replace(/\D/g, "").slice(0, 6);

  return {
    full_address: cleanString(l.full_address, 300) || undefined,
    locality: cleanString(l.locality, 100) || undefined,
    city: cleanString(l.city, 100) || undefined,
    district: cleanString(l.district, 100) || undefined,
    state: cleanString(l.state, 100) || undefined,
    pincode: pincode || undefined,
    lat,
    lng,
    approximate: l.approximate === true,
  };
}

function validateAvatarUrl(value: unknown): {
  provided: boolean;
  value?: string | null;
  error?: string;
} {
  if (!Object.prototype.hasOwnProperty.call(value ?? {}, "__dummy")) {
    // no-op; keeps function isolated from caller semantics
  }

  if (value === undefined) {
    return { provided: false };
  }

  if (value === null) {
    return { provided: true, value: null };
  }

  if (typeof value !== "string") {
    return {
      provided: true,
      error: "Invalid photo reference.",
    };
  }

  const v = value.trim().slice(0, 500);

  if (!v) {
    return {
      provided: true,
      value: null,
    };
  }

  // Local/file-mode avatar endpoint.
  if (v.startsWith("/api/uploads/av_")) {
    return {
      provided: true,
      value: v,
    };
  }

  // Vercel Blob public URL.
  if (v.startsWith("https://")) {
    try {
      const host = new URL(v).hostname.toLowerCase();

      const validBlobHost =
        host === "blob.vercel-storage.com" ||
        host.endsWith(".blob.vercel-storage.com");

      const validAvatarPath =
        v.includes("/hillsense/avatars/");

      if (validBlobHost && validAvatarPath) {
        return {
          provided: true,
          value: v,
        };
      }
    } catch {
      // handled below
    }
  }

  return {
    provided: true,
    error: "Invalid photo reference.",
  };
}

export async function POST(req: NextRequest) {
  // Profile edits live in the persistent store — refuse clearly when the
  // deployment cannot persist them instead of silently losing the save.
  const cfgErr = persistenceConfigError();
  if (cfgErr) return NextResponse.json(cfgErr, { status: 503 });

  try {
    const user = await userFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { error: "Your session is invalid or has expired. Please sign in again." },
        { status: 401 },
      );
    }

    let body: ProfileBody;

    try {
      body = (await req.json()) as ProfileBody;
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 },
      );
    }

    /*
     * -------------------------
     * Name
     * -------------------------
     */
    const hasName = Object.prototype.hasOwnProperty.call(body, "display_name");

    const name = hasName
      ? cleanString(body.display_name, 60)
      : user.display_name;

    if (!name) {
      return NextResponse.json(
        { error: "Please enter your name." },
        { status: 400 },
      );
    }

    /*
     * -------------------------
     * Email
     * -------------------------
     */
    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");

    const email = hasEmail
      ? cleanString(body.email, 120)
      : user.email ?? "";

    if (hasEmail && email && !validEmail(email)) {
      return NextResponse.json(
        { error: "That email address doesn't look valid." },
        { status: 400 },
      );
    }

    /*
     * -------------------------
     * Location
     * -------------------------
     */
    const hasLocation = Object.prototype.hasOwnProperty.call(body, "location");

    let location: ProfileLocation | undefined;

    if (hasLocation) {
      location = sanitizeLocation(body.location);

      if (body.location !== null && location === undefined) {
        return NextResponse.json(
          { error: "Invalid location data." },
          { status: 400 },
        );
      }
    }

    /*
     * -------------------------
     * Avatar
     * -------------------------
     */
    const avatarResult = validateAvatarUrl(body.avatar_url);

    if (avatarResult.error) {
      return NextResponse.json(
        { error: avatarResult.error },
        { status: 400 },
      );
    }

    const hasAvatar = avatarResult.provided;
    const nextAvatarUrl = hasAvatar
      ? avatarResult.value
      : user.avatar_url;

    /*
     * -------------------------
     * Persist
     * -------------------------
     */
    const updated = await updateUser(user.id, {
      display_name: name,
      ...(hasEmail
        ? {
            email: email || undefined,
          }
        : {}),
      ...(hasAvatar
        ? {
            avatar_url: nextAvatarUrl ?? undefined,
          }
        : {}),
      ...(hasLocation
        ? {
            location,
          }
        : {}),
      onboarded: true,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "User account could not be found." },
        { status: 404 },
      );
    }

    /*
     * Delete old avatar only after the new user record was successfully saved.
     */
    if (
      hasAvatar &&
      user.avatar_url &&
      user.avatar_url !== (nextAvatarUrl ?? null)
    ) {
      await deleteAvatarByUrl(user.avatar_url);
    }

    return NextResponse.json({
      user: publicUser(updated),
      saved: true,
    });
  } catch (error) {
    console.error("[api/auth/profile]", error);

    return NextResponse.json(
      {
        error: "Could not save your profile. Please try again.",
      },
      { status: 500 },
    );
  }
}