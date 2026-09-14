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
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setError("Geolocation is not available in this browser. Please enter your location manually.");
      return;
    }
    const seq = ++seqRef.current;
    setBusy(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (seq !== seqRef.current) return; // a newer request superseded this one
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
        } else {
          // Keep coordinates; label stays "lat, lng" and approximate stays true.
          setResolvingAddress(false);
        }
      },
      (err) => {
        if (seq !== seqRef.current) return;
        setBusy(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("Location permission was denied. You can enable it in your browser settings, or enter your location manually below.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError("Your location could not be determined right now. Please enter it manually.");
        } else if (err.code === err.TIMEOUT) {
          setError("Getting your location timed out. Please try again or enter it manually.");
        } else {
          setError("Could not get your location. Please enter it manually.");
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30_000 },
    );
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
