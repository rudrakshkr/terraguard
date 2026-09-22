import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Reverse geocoding proxy — device coordinates in, the most accurate available
 * human-readable address out.
 *
 * Uses OpenStreetMap's Nominatim service (free, no key, attribution required).
 * Running it server-side keeps a single, well-behaved client (required by
 * Nominatim's usage policy) and lets us cache responses briefly.
 *
 * Public (no sign-in): browsing the map and "Use my location" are open to
 * everyone. Abuse is contained by an in-memory per-IP rate limiter plus a
 * coordinate cache — at most one outbound request per unique coordinate.
 *
 * Address policy (presentation requirement): never degrade to a state/country
 * label such as "Punjab, India" when a more precise address is available. The
 * lookup always requests street-level detail (zoom 18) for device GPS fixes;
 * if Nominatim returns sparse administrative data, we compose the best
 * available combination of street/road, locality, town/city, district, state,
 * PIN code and country. Only when the fix itself is extremely coarse (mobile
 * networks can report a ±1000 km accuracy radius) is the result marked
 * "approximate" — and it still names the most specific places returned.
 *
 * Response shape (all optional except lat/lng):
 *   full_address, locality, city, district, state, pincode, lat, lng,
 *   approximate, source
 */

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  neighbourhood?: string;
  suburb?: string;
  city_district?: string;
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

/* --------------------------- address composition --------------------------- */

const clean = (s?: string) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : undefined;
};

/**
 * Build the clean display address: "[Street/Road or Locality], [Area/Town/
 * City], [District], [State], [PIN], India" — the best available combination,
 * with no repeated parts and no raw coordinates.
 */
function composeAddress(a: NominatimAddress): string {
  const road = clean(a.road) ?? clean(a.pedestrian);
  const house = clean(a.house_number);
  const street = house && road ? `${house} ${road}` : road ?? house;
  const area = clean(a.neighbourhood) ?? clean(a.suburb) ?? clean(a.city_district);
  const town =
    clean(a.village) ?? clean(a.town) ?? clean(a.city) ?? clean(a.hamlet) ?? clean(a.municipality);
  const district = clean(a.county) ?? clean(a.state_district);
  const state = clean(a.state);
  const pin = clean(a.postcode);
  const country = clean(a.country);

  const seen = new Set<string>();
  const parts: string[] = [];
  const push = (s?: string) => {
    if (!s) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(s);
  };

  // Street or locality first, then the town/city it sits in, then the wider
  // administrative area. A street name usually implies its town, so a long
  // "every subdivision" string is avoided on purpose.
  if (street && town) {
    push(street);
    push(area && area.toLowerCase() !== town.toLowerCase() ? area : undefined);
    push(town);
  } else if (street) {
    push(street);
    push(area);
  } else {
    // No street in the data (common for villages): area/locality, then town.
    push(area);
    push(town);
  }
  push(district);
  push(state);
  push(pin);
  push(country);
  return parts.join(", ");
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
  // Always request street-level detail for device fixes so the address is as
  // precise as the coordinates allow — precision of the *words* is handled by
  // the client's "approximate" marker, not by degrading the lookup.
  const zoom = accuracy !== null && accuracy > 100_000 ? 10 : 18;

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

    const locality = clean(a.village) ?? clean(a.neighbourhood) ?? clean(a.suburb) ?? clean(a.hamlet);
    const city = clean(a.town) ?? clean(a.city) ?? clean(a.municipality) ?? locality;
    const district = clean(a.county) ?? clean(a.state_district);
    const approximate = accuracy !== null && accuracy > 25_000;

    // Compose the best available address from the returned parts; if the
    // service returned nothing usable, fall back to its display name.
    const composed = composeAddress(a);
    const specificParts = [
      a.house_number, a.road, a.pedestrian, a.neighbourhood, a.suburb,
      a.city_district, a.village, a.town, a.city, a.hamlet, a.municipality,
      a.county, a.state_district, a.postcode,
    ].filter((v) => clean(v)).length;
    // Never return a misleading state/country-only address such as
    // "Punjab, India" for a device fix. When Nominatim is too sparse, the
    // client keeps its coordinates and asks the user to verify manually.
    const full = specificParts > 0 ? composed || clean(data.display_name) || "" : "";

    const payload = {
      full_address: full,
      locality,
      city,
      district,
      state: clean(a.state),
      pincode: clean(a.postcode),
      country: clean(a.country),
      lat,
      lng,
      approximate,
      source: "OpenStreetMap",
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