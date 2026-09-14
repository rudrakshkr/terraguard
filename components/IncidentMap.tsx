"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SEVERITY_META } from "@/lib/threat";
import type { Incident } from "@/lib/types";

const HIMACHAL_CENTER: [number, number] = [31.9, 77.1];

function dotIcon(severity: Incident["severity"], active: boolean) {
  const hex = SEVERITY_META[severity].hex;
  return L.divIcon({
    className: "",
    html: `<span class="marker-dot ${active ? "is-active" : ""}" style="display:block;width:14px;height:14px;background:${hex}"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -9],
  });
}

function FitBounds({ incidents }: { incidents: Incident[] }) {
  const map = useMap();
  useEffect(() => {
    if (incidents.length > 1) {
      const bounds = L.latLngBounds(incidents.map((i) => [i.lat, i.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
    } else if (incidents.length === 1) {
      map.setView([incidents[0].lat, incidents[0].lng], 11);
    }
  }, [incidents, map]);
  return null;
}

export default function IncidentMap({ incidents }: { incidents: Incident[] }) {
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-lg border border-[#223041]">
      <MapContainer
        center={HIMACHAL_CENTER}
        zoom={8}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds incidents={incidents} />
        {incidents.map((i) => (
          <Marker key={i.id} position={[i.lat, i.lng]} icon={dotIcon(i.severity, i.status === "Open" && i.severity === "Critical")}>
            <Popup>
              <div style={{ minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    className="marker-dot"
                    style={{ display: "inline-block", width: 10, height: 10, background: SEVERITY_META[i.severity].hex }}
                  />
                  <strong style={{ fontSize: 13 }}>{i.incident_type}</strong>
                  <span style={{ fontSize: 11, opacity: 0.75 }}>· {i.severity}</span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                  {i.id} · {i.location} · {i.status}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.45 }}>{i.summary}</div>
                <a
                  href={`/report/${i.id}`}
                  style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "#38bdf8", fontWeight: 600 }}
                >
                  Open incident report →
                </a>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
