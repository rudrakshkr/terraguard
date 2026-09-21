import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Reverse geocoding proxy — coordinates (+ optional accuracy) in, human-readable
 * address out.
 *
 * Uses OpenStreetMap's Nominatim service (free, no key, attribution required).
 * Running it server-side keeps a single, well-behaved client (required by
 * Nominatim's usage policy) and lets us cache responses briefly.
 *
 * Public (no sign-in): browsing the map and "Use my location" are open to
 * everyone, and a coordinate dump is useless to a guest. Abuse is contained by
 * an in-memory per-IP rate limiter plus a 10-minute coordinate cache — at most
 * one outbound Nominatim request per unique coordinate per TTL.
 *
 * The `accuracy` parameter (meters, from the browser's GeolocationPosition)
 * selects the address precision: asking for building-level detail for a
 * ±1000 km Wi-Fi/IP fix produces nonsense, so coarse fixes resolve at region
 * level instead ("Punjab, India").
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

/* --------------------------------- cache ---------------------------------- */

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500; // bound memory; oldest entries evicted
const cacheGet = (k: string) => {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (hit) cache.delete(k);
  return null;
};
const cacheSet = (k: string, data: unknown) => {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(k, { at: Date.now(), data });
};

/* ------------------------------ rate limiting ----------------------------- */

/**
 * Token bucket per client IP: Nominatim's usage policy caps light use at ~1
 * request/second. The coordinate cache absorbs repeats; this caps unique
 * lookups from a single client to a burst of 20, refilling one per 3 s.
 */
const RATE_CAPACITY = 20;
const RATE_REFILL_MS = 3_000;
const buckets = new Map<string, { tokens: number; last: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE_CAPACITY, last: now };
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + (now - b.last) / RATE_REFILL_MS);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return true;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  // Keep the map bounded.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (now - v.last > 10 * 60_000) buckets.delete(k);
    }
  }
  return false;
}

/* ------------------------- accuracy → address zoom ------------------------ */

/**
 * Nominatim zoom level appropriate for the position's reported accuracy.
 * The address shown to the user should never be more precise than the fix
 * itself: a phone on Wi-Fi (±2 km) gets town-level words, not a house number.
 */
function zoomForAccuracy(accuracyM: number | null): number {
  if (accuracyM === null || !Number.isFinite(accuracyM) || accuracyM <= 0) return 18;
  if (accuracyM <= 150) return 18; // building/street
  if (accuracyM <= 1_000) return 16; // street
  if (accuracyM <= 5_000) return 14; // suburb/town
  if (accuracyM <= 50_000) return 12; // village/town
  if (accuracyM <= 300_000) return 10; // city
  if (accuracyM <= 1_000_000) return 8; // district
  return 5; // state/region
}

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many location lookups — try again in a moment.", approximate: true },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const lat = Number.parseFloat(sp.get("lat") ?? "");
  const lng = Number.parseFloat(sp.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Valid lat/lng are required." }, { status: 400 });
  }
  const accuracyRaw = Number.parseFloat(sp.get("accuracy") ?? "");
  const accuracy = Number.isFinite(accuracyRaw) && accuracyRaw > 0 ? accuracyRaw : null;
  const zoom = zoomForAccuracy(accuracy);

  const key = `${lat.toFixed(5)},${lng.toFixed(5)}@${zoom}`;
  const cached = cacheGet(key);
  if (cached) return NextResponse.json(cached);

  try {
    const headers: HeadersInit = {
      "User-Agent": "HillSense/1.0 (community hazard reporting demo)",
      Accept: "application/json",
      "Accept-Language": "en",
    };
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${zoom}&addressdetails=1`,
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

    // Words for humans: prefer the full display name; fall back to whatever
    // parts Nominatim returned so the UI never has to print raw coordinates.
    const parts = [data.display_name].filter((s): s is string => Boolean(s && s.trim()));
    if (parts.length === 0) {
      const composed = [locality, city, district, a.state, a.country]
        .filter((s): s is string => Boolean(s && s.trim()))
        .join(", ");
      if (composed) parts.push(composed);
    }

    const payload = {
      full_address: parts[0] ?? "",
      locality,
      city,
      district,
      state: a.state,
      pincode: a.postcode,
      country: a.country,
      lat,
      lng,
      approximate,
      precision:
        zoom >= 16
          ? "building/street"
          : zoom >= 12
            ? "town/village"
            : zoom >= 8
              ? "district"
              : "region",
      source: "OpenStreetMap Nominatim",
    };

    cacheSet(key, payload);
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
