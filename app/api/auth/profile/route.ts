import { NextRequest, NextResponse } from "next/server";
import { userFromRequest, updateUser, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

interface ProfileBody {
  display_name?: string;
  email?: string;
  location?: {
    full_address?: string;
    locality?: string;
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
    lat?: number;
    lng?: number;
    approximate?: boolean;
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
    }
    const body = (await req.json()) as ProfileBody;

    const name = (body.display_name ?? "").trim().slice(0, 60);
    if (!name) {
      return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    }

    const email = (body.email ?? "").trim().slice(0, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "That email address doesn't look valid." }, { status: 400 });
    }

    // Location is optional but, when given, coordinates must be numbers in a
    // plausible range and the full address bounded.
    let location: ProfileBody["location"];
    if (body.location && typeof body.location === "object") {
      const l = body.location;
      const lat = typeof l.lat === "number" && Math.abs(l.lat) <= 90 ? l.lat : undefined;
      const lng = typeof l.lng === "number" && Math.abs(l.lng) <= 180 ? l.lng : undefined;
      location = {
        full_address: (l.full_address ?? "").toString().slice(0, 300) || undefined,
        locality: (l.locality ?? "").toString().slice(0, 100) || undefined,
        city: (l.city ?? "").toString().slice(0, 100) || undefined,
        district: (l.district ?? "").toString().slice(0, 100) || undefined,
        state: (l.state ?? "").toString().slice(0, 100) || undefined,
        pincode: (l.pincode ?? "").toString().replace(/\D/g, "").slice(0, 6) || undefined,
        lat,
        lng,
        approximate: l.approximate === true,
      };
    }

    const updated = await updateUser(user.id, {
      display_name: name,
      ...(email ? { email } : {}),
      location,
      onboarded: true,
    });
    if (!updated) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    return NextResponse.json({ user: publicUser(updated) });
  } catch (err) {
    console.error("[auth/profile]", err);
    return NextResponse.json({ error: "Could not save your profile." }, { status: 500 });
  }
}
