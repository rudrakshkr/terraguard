"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { haversineKm, fmtDistance, fmtAge, minutesSince } from "@/lib/geo";
import { originMeta } from "@/lib/threat";
import { exampleReportLabel } from "@/lib/labels";
import type { Incident } from "@/lib/types";

const HIMACHAL_CENTER: [number, number] = [31.9, 77.1];

const SEV_HEX: Record<string, string> = {
  Critical: "#dc2626",
  High: "#ea580c",
  Moderate: "#ca8a04",
  Low: "#16a34a",
};

function dotIcon(severity: Incident["severity"], active: boolean) {
  const hex = SEV_HEX[severity] ?? "#64748b";
  return L.divIcon({
    className: "",
    html: `<span class="marker-dot ${active ? "is-active" : ""}" style="display:block;width:14px;height:14px;background:${hex}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
  });
}

function userIcon() {
  return L.divIcon({
    className: "",
    html: `<span class="user-dot" style="display:block;width:16px;height:16px"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function FitBounds({
  incidents,
  userLoc,
}: {
  incidents: Incident[];
  userLoc: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [
      ...incidents.map((i) => [i.lat, i.lng] as [number, number]),
      ...(userLoc ? [[userLoc.lat, userLoc.lng] as [number, number]] : []),
    ];
    if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 12 });
    } else if (pts.length === 1) {
      map.setView(pts[0], 11);
    }
  }, [incidents, userLoc, map]);
  return null;
}

export default function IncidentMap({
  incidents,
  userLoc,
}: {
  incidents: Incident[];
  userLoc?: { lat: number; lng: number; label?: string } | null;
}) {
  const shownUser = userLoc ?? null;
  // Shorter on phones so the map never dominates the viewport; full height from
  // sm upward where there is room for it.
  return (
    <div className="h-[300px] w-full overflow-hidden rounded-lg border sm:h-[380px]" style={{ borderColor: "var(--border)" }}>
      <MapContainer center={HIMACHAL_CENTER} zoom={8} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds incidents={incidents} userLoc={shownUser} />

        {shownUser && (
          <>
            <Marker position={[shownUser.lat, shownUser.lng]} icon={userIcon()} aria-label="Your location">
              <Popup>{shownUser.label ?? "Your location"}</Popup>
            </Marker>
            <Circle
              center={[shownUser.lat, shownUser.lng]}
              radius={10000}
              pathOptions={{ color: "#0e7490", weight: 1, fillOpacity: 0.04 }}
            />
          </>
        )}

        {incidents.map((i) => {
          const km = shownUser ? haversineKm(shownUser.lat, shownUser.lng, i.lat, i.lng) : null;
          return (
            <Marker
              key={i.id}
              position={[i.lat, i.lng]}
              icon={dotIcon(i.severity, i.status === "Open" && (i.severity === "Critical" || i.severity === "High"))}
              aria-label={`${i.incident_type} — ${i.severity}`}
            >
              <Popup>
                <div style={{ minWidth: 230 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span
                      className="marker-dot"
                      style={{ display: "inline-block", width: 10, height: 10, background: SEV_HEX[i.severity] }}
                    />
                    <strong style={{ fontSize: 13 }}>{i.incident_type}</strong>
                    <span style={{ fontSize: 11, opacity: 0.75 }}>{i.severity}</span>
                  </div>
                  <div style={{ fontSize: 10.5, marginBottom: 6 }}>
                    <span
                      style={{
                        background: i.origin === "seed" ? "rgba(202,138,4,0.15)" : "rgba(14,116,144,0.12)",
                        color: i.origin === "seed" ? "#a16207" : "#0e7490",
                        borderRadius: 999,
                        padding: "1px 8px",
                        fontWeight: 600,
                      }}
                    >
                      {originMeta(i.origin).label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 6 }}>{i.summary}</div>
                  <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 6 }}>
                    {km != null ? `${fmtDistance(km)} · ` : ""}
                    {i.origin === "seed"
                      ? exampleReportLabel(i.created_at)
                      : `reported ${fmtAge(minutesSince(i.created_at))}`}{' · '}
                    {i.status === "Responding" ? "Active" : i.status}
                  </div>
                  <a href={`/incident/${i.id}`} style={{ fontSize: 12, color: "#0e7490", fontWeight: 600 }}>
                    View details →
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
