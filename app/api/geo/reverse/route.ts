import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Reverse geocoding proxy — coordinates in, human-readable address out.
 *
 * Uses OpenStreetMap's Nominatim service (free, no key, attribution required).
 * Running it server-side keeps a single, well-behaved client (required by
 * Nominatim's usage policy) and lets us cache responses briefly.
 *
 * Response shape (all optional except lat/lng):
 *   full_address, locality, city, district, state, pincode, lat, lng,
 *   approximate (true when only a coarse result was available)
 */

interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state_district?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

interface NominatimResult {
  display_name?: string;
  address?: NominatimAddress;
  lat?: string;
  lon?: string;
  boundingbox?: string[];
  osm_type?: string;
  addresstype?: string;
}

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 10 * 60_000;
const cacheGet = (k: string) => {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(k);
  return null;
};

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Sign in to use location lookup." }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const lat = Number.parseFloat(sp.get("lat") ?? "");
  const lng = Number.parseFloat(sp.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Valid lat/lng are required." }, { status: 400 });
  }

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached) return NextResponse.json(cached);

  try {
    const headers: HeadersInit = {
      "User-Agent": "HillSense/1.0 (community hazard reporting demo)",
      Accept: "application/json",
      "Accept-Language": "en",
    };
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: "Reverse geocoding service unavailable.", approximate: true, lat, lng },
        { status: 502 },
      );
    }
    const data = (await res.json()) as NominatimResult;
    const a = data.address ?? {};

    const locality =
      a.village ?? a.neighbourhood ?? a.suburb ?? a.town ?? a.hamlet ?? undefined;
    const city = a.town ?? a.city ?? a.municipality ?? locality;
    const district = a.state_district ?? a.county ?? undefined;

    // A "coarse" result (e.g. only state/country matched) is honest about being approximate.
    const approximate = !locality && !a.road;

    const payload = {
      full_address: data.display_name ?? "",
      locality,
      city,
      district,
      state: a.state,
      pincode: a.postcode,
      country: a.country,
      lat,
      lng,
      approximate,
      precision: data.osm_type === "way" || data.osm_type === "relation" ? "building/street" : "area",
      source: "OpenStreetMap Nominatim",
    };

    cache.set(key, { at: Date.now(), data: payload });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[geo/reverse]", err);
    return NextResponse.json(
      {
        error: "Could not resolve an address for these coordinates.",
        lat,
        lng,
        approximate: true,
      },
      { status: 200 },
    );
  }
}
