"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "./useAuth";

export interface ResolvedAddress {
  full_address: string;
  locality?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
  lat: number;
  lng: number;
  approximate: boolean;
  precision?: string;
  source?: string;
  error?: string;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  label: string; // human-readable, never a snapped fake town
  preset: string | null;
  approximate: boolean;
  accuracy?: number;
  address?: ResolvedAddress | null;
  source: "gps" | "preset" | "manual" | "profile";
}

const KEY = "hillsense-location";

/** Optional quick picks — clearly manual choices, never a geolocation fallback. */
export const PRESETS = [
  { name: "Shimla", lat: 31.1048, lng: 77.1734 },
  { name: "Manali", lat: 32.2432, lng: 77.1892 },
  { name: "Kullu", lat: 31.9578, lng: 77.1095 },
  { name: "Mandi", lat: 31.7086, lng: 76.9314 },
  { name: "Chamba", lat: 32.5519, lng: 76.1296 },
  { name: "Dharamshala", lat: 32.219, lng: 76.3234 },
  { name: "Palampur", lat: 32.1106, lng: 76.5403 },
  { name: "Solan", lat: 30.9045, lng: 77.0967 },
];

export function coordsLabel(lat: number, lng: number, accuracy?: number): string {
  const base = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (typeof accuracy === "number" && Number.isFinite(accuracy)) {
    return `${base} (±${Math.round(accuracy)} m)`;
  }
  return base;
}

/* ------------------------------------------------------------------------ */
/* Geolocation error handling                                                */
/* ------------------------------------------------------------------------ */

/** Standard GeolocationPositionError codes (W3C spec values). */
const GEO_PERMISSION_DENIED = 1;
const GEO_POSITION_UNAVAILABLE = 2;
const GEO_TIMEOUT = 3;

/**
 * Extract the numeric error code defensively.
 *
 * Several engines (embedded webviews, some mobile in-app browsers) do NOT put
 * the PERMISSION_DENIED/POSITION_UNAVAILABLE/TIMEOUT constants on the error
 * instance, so the common `err.code === err.TIMEOUT` comparison silently fails
 * and every failure looks like an unknown error. Compare against the spec
 * numbers instead, and tolerate exotic shapes (code as string, missing code).
 */
function geoErrorCode(err: unknown): number {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string") {
    const n = Number.parseInt(code, 10);
    if (Number.isFinite(n)) return n;
  }
  return -1;
}

/** Pick the most useful message from every attempt's error code. */
function geoErrorMessage(codes: number[]): string {
  if (codes.includes(GEO_PERMISSION_DENIED)) {
    return "Location permission was denied. Enable it in your browser settings (tap the padlock icon → Location), or enter your location manually below.";
  }
  if (codes.includes(GEO_POSITION_UNAVAILABLE)) {
    return "Your device could not determine a position right now. Please try again, or enter your location manually below.";
  }
  if (codes.includes(GEO_TIMEOUT)) {
    return "Getting your location timed out. Please try again, or enter your location manually below.";
  }
  return "Could not get your location in this browser. Please enter your location manually below.";
}

/**
 * Real geolocation + reverse geocoding.
 *
 * `useMyLocation` NEVER snaps to a preset town. It:
 *   1. requests browser geolocation permission
 *   2. captures the actual coordinates + accuracy
 *   3. reverse-geocodes them via /api/geo/reverse (OpenStreetMap Nominatim)
 *   4. fills the readable address; if reverse geocoding fails it honestly
 *      shows the coordinates labelled as approximate.
 */
export function useLocationPreference() {
  const [loc, setLoc] = useState<GeoLocation | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) setLoc(JSON.parse(raw) as GeoLocation);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const persist = useCallback((l: GeoLocation | null) => {
    setLoc(l);
    try {
      if (l) localStorage.setItem(KEY, JSON.stringify(l));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Resolve a human-readable address for the given coordinates.
   * Requires auth (route is user-scoped); falls back to coordinates-only.
   */
  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<ResolvedAddress | null> => {
    try {
      const res = await authFetch(`/api/geo/reverse?lat=${lat}&lng=${lng}`);
      if (!res.ok) return null;
      const data = (await res.json()) as ResolvedAddress & { error?: string };
      if (data.error && !data.full_address) return null;
      return data;
    } catch {
      return null;
    }
  }, []);

  const useMyLocation = useCallback(() => {
    setError(null);
    if (typeof navigator === "undefined" || !("geolocation" in navigator) || !navigator.geolocation) {
      // Usually an insecure origin (geolocation needs HTTPS or localhost) or a
      // webview that strips the API entirely.
      setError(
        "Geolocation is not available here — it needs a secure connection (HTTPS or localhost) and a browser that supports it. Please enter your location manually.",
      );
      return;
    }
    // The API can exist yet be hard-blocked: browsers only allow geolocation on
    // secure origins, so a demo opened over LAN HTTP (http://192.168.x.x:3000)
    // fails with a misleading "permission denied" no matter what the user picks.
    // Detect that up front and say the one thing that actually fixes it.
    const secureOrigin =
      typeof window !== "undefined" &&
      (window.isSecureContext ||
        location.protocol === "https:" ||
        ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname));
    if (!secureOrigin) {
      setError(
        "Browsers block location on non-HTTPS pages. Open this app over HTTPS or on localhost, or enter your location manually below.",
      );
      return;
    }
    const seq = ++seqRef.current;
    setBusy(true);

    const requestPosition = (opts: PositionOptions) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, opts);
      });

    const run = async () => {
      // Two attempts: device GPS first (precise when a fix is available), then
      // the coarse WiFi/IP provider. Desktops, indoor phones and embedded
      // browsers frequently have no GPS fix but still produce a usable coarse
      // position — without the fallback those users saw "Could not get your
      // location" every single time.
      const attempts: PositionOptions[] = [
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      ];

      const codes: number[] = [];
      let pos: GeolocationPosition | null = null;
      for (const opts of attempts) {
        try {
          pos = await requestPosition(opts);
          break;
        } catch (err) {
          if (seq !== seqRef.current) return; // a newer request superseded this one
          const code = geoErrorCode(err);
          codes.push(code);
          console.warn(
            "[geo] getCurrentPosition failed",
            code,
            (err as { message?: string } | null)?.message ?? "",
          );
          if (code === GEO_PERMISSION_DENIED) break; // retrying cannot change permission
        }
      }
      if (seq !== seqRef.current) return;

      if (!pos) {
        setBusy(false);
        setError(geoErrorMessage(codes));
        return;
      }

      const { latitude, longitude, accuracy } = pos.coords;
      // Honest immediate state: real coordinates, no address yet, clearly approximate.
      persist({
        lat: latitude,
        lng: longitude,
        label: coordsLabel(latitude, longitude, accuracy),
        preset: null,
        approximate: true,
        accuracy,
        address: null,
        source: "gps",
      });
      setBusy(false);
      setResolvingAddress(true);
      const address = await reverseGeocode(latitude, longitude);
      if (seq !== seqRef.current) return;
      setResolvingAddress(false);
      if (address) {
        persist({
          lat: latitude,
          lng: longitude,
          label: address.full_address || coordsLabel(latitude, longitude, accuracy),
          preset: null,
          approximate: Boolean(address.approximate),
          accuracy,
          address,
          source: "gps",
        });
      }
      // No address: keep the coordinates; label stays "lat, lng", approximate stays true.
    };

    void run();
  }, [persist, reverseGeocode]);

  const applyPreset = useCallback(
    (name: string) => {
      const p = PRESETS.find((x) => x.name === name);
      if (!p) return;
      setError(null);
      persist({ lat: p.lat, lng: p.lng, label: p.name, preset: p.name, approximate: false, address: null, source: "preset" });
    },
    [persist],
  );

  /** Manual free-text place. Coordinates unknown → honest approximate marker. */
  const useCustom = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const preset = PRESETS.find((x) => x.name.toLowerCase() === trimmed.toLowerCase());
      if (preset) {
        applyPreset(preset.name);
        return;
      }
      setError(null);
      // No fake coordinates: store the typed name; approximate without coords means
      // "no map position" — callers must treat lat/lng as optional here.
      persist({ lat: NaN, lng: NaN, label: trimmed, preset: null, approximate: true, address: null, source: "manual" });
    },
    [persist, applyPreset],
  );

  /** Adopt a resolved address directly (used by onboarding & report form). */
  const setAddress = useCallback(
    (address: ResolvedAddress) => {
      setError(null);
      persist({
        lat: address.lat,
        lng: address.lng,
        label: address.full_address || coordsLabel(address.lat, address.lng),
        preset: null,
        approximate: Boolean(address.approximate),
        address,
        source: "gps",
      });
    },
    [persist],
  );

  const clear = useCallback(() => persist(null), [persist]);

  return {
    loc,
    busy,
    resolvingAddress,
    error,
    useMyLocation,
    pickPreset: applyPreset,
    setCustom: useCustom,
    setAddress,
    reverseGeocode,
    clear,
    setError,
  };
}
