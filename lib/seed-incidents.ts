import type { Incident } from "./types";

/**
 * Fixed, static timestamps for the example dataset.
 *
 * Demo incidents must NOT show fake live ticks like "3 minutes ago" — the
 * timestamps are fixed dates so every screen shows the same honest label
 * ("Example report · 21 Sep 2026"). They stay consistent across restarts.
 */
function fixedISO(daysAgo: number, hour = 9, minute = 30): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Fixed demo date used in static labels ("Example report · 21 Sep 2026"). */
export const DEMO_SEED_DATE_LABEL = "21 Sep 2026";

type Seed = Omit<Incident, "id" | "created_at" | "origin"> & { daysAgo: number; /** Internal model score — never shown to users (see EvidenceChip). */ confidence: number };

const SEEDS: Seed[] = [
  {
    // 1) AI CHECK PASSED — public, with community confirmations + an update.
    daysAgo: 1,
    location: "Jail Road, Civil Lines, Ludhiana, Punjab 141001",
    lat: 30.9010,
    lng: 75.8573,
    incident_type: "Flood",
    severity: "Critical",
    status: "Open",
    description:
      "Example report — heavy rain has flooded the underpass on Jail Road, Civil Lines. Water is knee-deep and a bus is stuck in the water.",
    summary:
      "Jail Road underpass flooded after heavy rain; knee-deep water, one bus stranded. Traffic diverted.",
    confidence: 0.92,
    risk_factors: [
      "Water level rising faster than it drains",
      "Stranded vehicle blocking the outlet lane",
    ],
    immediate_actions: [
      "Avoid the underpass until water recedes",
      "Follow the diversions put up by traffic police",
      "Do not attempt to wade or drive through standing water",
    ],
    avoid: [
      "Do not drive through the flooded stretch",
      "Avoid touching electric poles or wiring near standing water",
    ],
    recommended_response:
      "Notify local emergency services and follow district authorities' instructions.",
    requires_urgent_attention: true,
    sources: [{ title: "Flood Safety" }, { title: "Emergency Preparedness" }],
  },
  {
    // 2) NEEDS REVIEW — saved for review, NOT shown publicly.
    daysAgo: 1,
    location: "Old Kullu Road, Bhuntar",
    lat: 32.0,
    lng: 77.13,
    incident_type: "Landslide",
    severity: "High",
    status: "Open",
    description:
      "Example report — possible landslide on the old Kullu road. Photo was unclear, so the evidence could not be confirmed automatically.",
    summary:
      "Possible landslide on the old Kullu road; evidence unclear — held for review, not shown publicly.",
    confidence: 0.45,
    risk_factors: [
      "Slope above the road is saturated after continuous rain",
    ],
    immediate_actions: [
      "Use caution on this stretch until the report is reviewed",
      "Report any fresh debris to local authorities",
    ],
    avoid: ["Do not stop below the suspected slide zone"],
    recommended_response:
      "Await review; notify local authorities if the road is obstructed.",
    requires_urgent_attention: false,
    sources: [{ title: "Landslide Safety" }],
  },
  {
    // 3) NOT PUBLISHED / REJECTED — hidden from the public feed.
    daysAgo: 2,
    location: "Solan",
    lat: 30.9045,
    lng: 77.0967,
    incident_type: "Other",
    severity: "Low",
    status: "Open",
    description:
      "Example report — text description did not match the attached photo, so the report was not published.",
    summary:
      "Example of a report held back: image and description described different situations, so it was not published.",
    confidence: 0.3,
    risk_factors: [],
    immediate_actions: [
      "No public action — this report is not displayed to nearby users",
    ],
    avoid: [],
    recommended_response: "Reporter informed that the report was not published.",
    requires_urgent_attention: false,
    sources: [{ title: "Emergency Preparedness" }],
  },
  {
    daysAgo: 3,
    location: "Manali",
    lat: 32.2432,
    lng: 77.1892,
    incident_type: "Road Blockage",
    severity: "High",
    status: "Open",
    description:
      "Example report — fallen trees and rubble are blocking the road outside Manali after a storm. Traffic is queued for several kilometres.",
    summary:
      "Storm-blown trees and rubble blocking the Manali road approach; long queue of stranded vehicles.",
    confidence: 0.88,
    risk_factors: [
      "Long queue of stranded vehicles on a narrow stretch",
      "Single-road dependency for nearby villages",
    ],
    immediate_actions: [
      "Place warning markers at both approaches",
      "Inform traffic police and request tree-clearing crew",
      "Share water and updates with stranded travellers",
    ],
    avoid: ["Do not overtake the queue toward the debris", "Avoid unverified shortcuts"],
    recommended_response:
      "Notify local emergency services and follow district authorities' instructions.",
    requires_urgent_attention: true,
    sources: [{ title: "Road Blockage Response" }],
  },
  {
    daysAgo: 2,
    location: "Mandi",
    lat: 31.7086,
    lng: 76.9314,
    incident_type: "Flash Flood",
    severity: "Critical",
    status: "Open",
    description:
      "Example report — rapidly rising muddy water in a mountain river near Mandi after a cloudburst upstream. Riverside camps moved to high ground.",
    summary:
      "Cloudburst-driven flash flood surge on a river near Mandi; riverside camps moved to high ground.",
    confidence: 0.94,
    risk_factors: [
      "Rapidly rising river with debris flow upstream",
      "Tourists and camps within the flood margin",
    ],
    immediate_actions: [
      "Move everyone to high ground immediately",
      "Warn all riverside camps downstream",
      "Notify local emergency services and follow district authorities' instructions",
    ],
    avoid: [
      "Never cross the rising river on foot or by vehicle",
      "Do not return for belongings in the flood path",
    ],
    recommended_response:
      "Notify local emergency services and follow district authorities' instructions.",
    requires_urgent_attention: true,
    sources: [{ title: "Flash Flood Safety" }],
  },
  {
    daysAgo: 2,
    location: "Mandi",
    lat: 31.7454,
    lng: 76.9938,
    incident_type: "Rockfall",
    severity: "Moderate",
    status: "Open",
    description:
      "Example report — rocks covering part of the road on the Mandi stretch after night rain. Traffic is moving slowly on one lane.",
    summary: "Rockfall debris partially blocking a road section near Mandi; single-lane movement.",
    confidence: 0.81,
    risk_factors: [
      "Loose rock overhang above the carriageway",
      "Reduced visibility around the bend",
    ],
    immediate_actions: [
      "Stop traffic at a safe distance; flag vehicles through one lane",
      "Report the exact landmark to local authorities",
    ],
    avoid: ["Do not stop below the overhang", "Do not attempt to move large boulders"],
    recommended_response:
      "Request clearance through local authorities and inspect the slope before reopening both lanes.",
    requires_urgent_attention: false,
    sources: [{ title: "Road Blockage Response" }, { title: "Mountain Travel Safety" }],
  },
  {
    daysAgo: 3,
    location: "Mandi",
    lat: 31.725,
    lng: 76.955,
    incident_type: "Road Blockage",
    severity: "Moderate",
    status: "Open",
    description:
      "Example report — debris and slush washing onto the Mandi–Jogindernagar road after continuous rain; traffic crawling on a single lane near the bridge.",
    summary:
      "Rain-washed debris narrowing the Mandi–Jogindernagar road near the bridge; one-lane traffic.",
    confidence: 0.79,
    risk_factors: [
      "Continued rain feeding more slush onto the carriageway",
      "Narrow bridge approach limiting passing traffic",
    ],
    immediate_actions: [
      "Place cones and warning markers at the approach",
      "Inform local authorities for debris clearance",
    ],
    avoid: ["Do not overtake at the bridge approach", "Avoid stopping in the slush line"],
    recommended_response:
      "Deploy a clearance crew during a rain break and reassess the slope above the road.",
    requires_urgent_attention: false,
    sources: [{ title: "Road Blockage Response" }],
  },
  {
    // Resolved example — also has community confirmations.
    daysAgo: 5,
    location: "Chamba",
    lat: 32.5519,
    lng: 76.1296,
    incident_type: "Building Damage",
    severity: "Moderate",
    status: "Resolved",
    description:
      "Example report — cracks developed in the wall of a house after continuous rain in Chamba. Family shifted to a relative's home.",
    summary: "Rain-induced structural cracks in a Chamba house; family relocated, assessment done.",
    confidence: 0.74,
    risk_factors: ["Progressive cracking of a saturated wall"],
    immediate_actions: ["Do not enter cracked buildings until assessed"],
    avoid: ["Do not enter cracked buildings"],
    recommended_response:
      "A local engineer assessed the structure; family to return after repairs are certified.",
    requires_urgent_attention: false,
    sources: [{ title: "Emergency Preparedness" }],
  },
  {
    daysAgo: 6,
    location: "Dharamshala",
    lat: 32.219,
    lng: 76.3234,
    incident_type: "Other",
    severity: "Low",
    status: "Resolved",
    description:
      "Example report — minor slope slush on a walking trail near Dharamshala after rain; trail slippery but passable.",
    summary: "Minor slush on a Dharamshala trail; caution advised, no blockage.",
    confidence: 0.66,
    risk_factors: ["Slippery trail surface"],
    immediate_actions: ["Advise trekkers to use caution"],
    avoid: ["Avoid the trail during active rain"],
    recommended_response: "Trail monitored; no further action required.",
    requires_urgent_attention: false,
    sources: [{ title: "Mountain Travel Safety" }],
  },
];

/**
 * Example (seed) incidents for first boot — clearly labelled demo data with a
 * deliberate mix of outcomes so the review pipeline is demonstrated honestly:
 *   - most reports PASS the AI evidence check and are published,
 *   - one is NEEDS REVIEW (unclear evidence — not shown publicly),
 *   - one is NOT PUBLISHED (conflicting evidence — held back),
 *   - several carry community confirmations and updates.
 * Timestamps are static dates so no screen shows a fake live "just now".
 */
export function seedIncidents(): Incident[] {
  return SEEDS.map((s, i) => {      const { daysAgo, ...rest } = s;
    const created = fixedISO(daysAgo);
    // Confirmations come from the example community; updates land a few hours
    // after the report. Index 0 (Ludhiana flood) is the "confirmed" showcase.
    const confirmYes = [4, 0, 0, 2, 3, 1, 0, 2, 0][i] ?? 0;
    const updatedAt = fixedISO(daysAgo, 15, 45);
    return {
      ...rest,
      id: `HS-${String(1000 + i)}`,
      created_at: created,
      origin: "seed" as const,
      verification:
        i === 1 ? ("needs_review" as const) : i === 2 ? ("rejected" as const) : ("verified" as const),
      verification_reasons: [
        "Example report prepared for the demonstration dataset",
        "Severity assessment consistent with the reported description",
      ],
      publication:
        i === 1 ? ("review_only" as const) : i === 2 ? ("hidden" as const) : ("public" as const),
      reporter_label: "Example community member",
      confidence: s.confidence,
      last_confirmed_at: confirmYes > 0 ? updatedAt : created,
      confirmations_yes: confirmYes,
      confirmations_no: 0,
      status_history: [{ status: rest.status, at: created }],
    };
  });
}

/** Demo scenarios for the one-click "run the whole pipeline" experience. */
export const DEMO_SCENARIOS = [
  {
    id: "landslide",
    label: "Landslide — Kullu",
    emoji: "⛰️",
    description: "A road near Kullu is blocked by debris during heavy rainfall.",
    text: "Heavy rain has triggered a landslide and blocked the road near Kullu. A large mass of mud and debris has come down the slope onto the highway and several vehicles are stuck behind it.",
    location: "Kullu",
  },
  {
    id: "flash-flood",
    label: "Flash Flood — riverside",
    emoji: "🌊",
    description: "A tourist reports rapidly rising water near a mountain river.",
    text: "I am a tourist staying at a camp near the river. The water has started rising very fast and it has turned muddy. Our camp is close to the water and the rain upstream is very heavy.",
    location: "Mandi",
  },
  {
    id: "rockfall",
    label: "Rockfall — road",
    emoji: "🪨",
    description: "A road user uploads an image showing rocks covering part of a road.",
    text: "Rocks have fallen on the road after last night's rain. Part of the road is covered and vehicles are slowly passing on one side. There is loose rock still hanging above the road.",
    location: "Mandi",
  },
] as const;
