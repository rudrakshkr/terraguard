import type { Incident } from "./types";

/** ISO timestamp offset from now, so the dashboard always looks fresh. */
function minsAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

type Seed = Omit<Incident, "id" | "created_at" | "origin"> & { ageMins: number };

const SEEDS: Seed[] = [
  {
    ageMins: 42,
    location: "Kullu",
    lat: 31.9578,
    lng: 77.1095,
    incident_type: "Landslide",
    severity: "Critical",
    status: "Open",
    description:
      "Heavy rain has triggered a landslide and blocked a road near Kullu. Debris has slid onto the highway and several vehicles are stuck.",
    summary:
      "Landslide debris has blocked the road near Kullu during continuous heavy rainfall; vehicles stranded behind the blockage.",
    confidence: 0.92,
    risk_factors: [
      "Active rainfall destabilising the slope above the road",
      "Vehicles and commuters stranded behind the debris",
      "Fresh cracks visible on the cut slope — risk of secondary slide",
    ],
    immediate_actions: [
      "Stop traffic at both approaches and cordon the debris field",
      "Move stranded people away from the slide path to stable ground",
      "Alert Kullu district administration and request SDRF support",
    ],
    avoid: [
      "Do not cross or climb the debris mass",
      "Avoid parking below the cut slope",
    ],
    recommended_response:
      "Divert traffic via the alternate route, deploy PWD clearance machinery, and keep the slope under watch for secondary failure.",
    requires_urgent_attention: true,
    sources: [{ title: "Landslide Safety" }, { title: "Road Blockage Response" }],
  },
  {
    ageMins: 95,
    location: "Manali",
    lat: 32.2432,
    lng: 77.1892,
    incident_type: "Road Blockage",
    severity: "High",
    status: "Open",
    description:
      "Fallen trees and rubble are blocking the road outside Manali after a storm last night. Traffic is queued for several kilometres.",
    summary:
      "Storm-blown trees and rubble blocking the Manali road approach; long queue of stranded vehicles.",
    confidence: 0.88,
    risk_factors: [
      "Long queue of stranded vehicles on a narrow stretch",
      "Single-road dependency for nearby villages",
      "Unstable slope above the blocked section",
    ],
    immediate_actions: [
      "Place warning markers at both approaches",
      "Inform traffic police and request tree-clearing crew",
      "Share water and updates with stranded travellers",
    ],
    avoid: ["Do not overtake the queue toward the debris", "Avoid unverified shortcuts"],
    recommended_response:
      "Coordinate clearance with PWD, publish the alternate route, and update commuters hourly.",
    requires_urgent_attention: true,
    sources: [{ title: "Road Blockage Response" }],
  },
  {
    ageMins: 20,
    location: "Mandi",
    lat: 31.7086,
    lng: 76.9314,
    incident_type: "Flash Flood",
    severity: "Critical",
    status: "Responding",
    description:
      "Tourists report rapidly rising muddy water in a mountain river near Mandi after a cloudburst upstream. Riverside camps are being evacuated.",
    summary:
      "Cloudburst-driven flash flood surge on a river near Mandi; riverside camps evacuating to high ground.",
    confidence: 0.94,
    risk_factors: [
      "Rapidly rising river with debris flow upstream",
      "Tourists and camps within the flood margin",
      "Possible logjam forming downstream",
    ],
    immediate_actions: [
      "Move everyone to high ground immediately",
      "Warn all riverside camps downstream",
      "Keep SDRF rescue teams on standby",
    ],
    avoid: [
      "Never cross the rising river on foot or by vehicle",
      "Do not return for belongings in the flood path",
    ],
    recommended_response:
      "Issue a local alert along the river, complete camp evacuation, and monitor the river until levels recede.",
    requires_urgent_attention: true,
    sources: [{ title: "Flash Flood Safety" }],
  },
  {
    ageMins: 160,
    location: "Mandi",
    lat: 31.7454,
    lng: 76.9938,
    incident_type: "Rockfall",
    severity: "Moderate",
    status: "Open",
    description:
      "Rocks covering part of the road on the Mandi stretch after night rain. Traffic is moving slowly on one lane.",
    summary: "Rockfall debris partially blocking a road section near Mandi; single-lane movement.",
    confidence: 0.81,
    risk_factors: [
      "Loose rock overhang above the carriageway",
      "Reduced visibility around the bend",
    ],
    immediate_actions: [
      "Stop traffic at a safe distance; flag vehicles through one lane",
      "Report the exact landmark to highway authorities",
    ],
    avoid: ["Do not stop below the overhang", "Do not attempt to move large boulders"],
    recommended_response:
      "Request rock-clearance machinery and inspect the slope before reopening both lanes.",
    requires_urgent_attention: false,
    sources: [{ title: "Road Blockage Response" }, { title: "Mountain Travel Safety" }],
  },
  {
    ageMins: 75,
    location: "Mandi",
    lat: 31.725,
    lng: 76.955,
    incident_type: "Road Blockage",
    severity: "Moderate",
    status: "Open",
    description:
      "Debris and slush washing onto the Mandi–Jogindernagar road after continuous rain; traffic crawling on a single lane near the bridge.",
    summary:
      "Rain-washed debris narrowing the Mandi–Jogindernagar road near the bridge; one-lane traffic.",
    confidence: 0.79,
    risk_factors: [
      "Continued rain feeding more slush onto the carriageway",
      "Narrow bridge approach limiting passing traffic",
    ],
    immediate_actions: [
      "Place cones and warning markers at the approach",
      "Inform highway authorities for debris clearance",
    ],
    avoid: ["Do not overtake at the bridge approach", "Avoid stopping in the slush line"],
    recommended_response:
      "Deploy a clearance crew during a rain break and reassess the slope above the road.",
    requires_urgent_attention: false,
    sources: [{ title: "Road Blockage Response" }],
  },
  {
    ageMins: 240,
    location: "Shimla",
    lat: 31.087,
    lng: 77.145,
    incident_type: "Forest Fire",
    severity: "High",
    status: "Responding",
    description:
      "Smoke and flames visible on the forested slope near Shimla; fire is spreading uphill with the afternoon wind.",
    summary: "Forest fire spreading uphill on a slope near Shimla, driven by afternoon winds.",
    confidence: 0.86,
    risk_factors: [
      "Wind-driven spread toward habitations",
      "Dry pine-needle litter acting as fuel",
      "Smoke reducing highway visibility",
    ],
    immediate_actions: [
      "Alert the Forest Department fire crew",
      "Move settlements downwind to open ground",
    ],
    avoid: ["Do not attempt to outrun a fire uphill", "Avoid dry grass slopes"],
    recommended_response:
      "Create control lines with trained crews and prepare nearby villages for evacuation.",
    requires_urgent_attention: true,
    sources: [{ title: "Evacuation Guidance" }],
  },
  {
    ageMins: 60 * 30,
    location: "Chamba",
    lat: 32.5519,
    lng: 76.1296,
    incident_type: "Building Damage",
    severity: "Moderate",
    status: "Resolved",
    description:
      "Cracks developed in the wall of a house after continuous rain in Chamba. Family shifted to a relative's home.",
    summary: "Rain-induced structural cracks in a Chamba house; family relocated, assessment done.",
    confidence: 0.74,
    risk_factors: ["Progressive cracking of a saturated wall"],
    immediate_actions: ["Evacuate the structure", "Request a structural assessment"],
    avoid: ["Do not enter cracked buildings"],
    recommended_response:
      "Municipal engineer assessed the structure; family to return after repairs are certified.",
    requires_urgent_attention: false,
    sources: [{ title: "Emergency Preparedness" }],
  },
  {
    ageMins: 60 * 50,
    location: "Dharamshala",
    lat: 32.219,
    lng: 76.3234,
    incident_type: "Other",
    severity: "Low",
    status: "Resolved",
    description:
      "Minor slope slush on a walking trail near Dharamshala after rain; trail slippery but passable.",
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
 * Seed incidents for first boot. Ages are relative to first-run time.
 * All seeds are published demonstration data: verified, public, marked DEMO DATA.
 * The three Mandi-area rows (20, 75 & 160 min) intentionally form a small
 * cluster for the "AI-detected incident cluster" demo.
 */
export function seedIncidents(): Incident[] {
  return SEEDS.map((s, i) => {
    const { ageMins, ...rest } = s;
    return {
      ...rest,
      id: `HS-${String(1000 + i)}`,
      created_at: minsAgo(ageMins),
      origin: "seed" as const,
      verification: "verified" as const,
      verification_reasons: [
        "Demonstration seed — sample evidence prepared for the Engineering Day demo",
        "Severity assessment consistent with the reported description",
      ],
      publication: "public" as const,
      reporter_label: "Demo dataset",
      last_confirmed_at: minsAgo(Math.min(10, ageMins)),
      confirmations_yes: 0,
      confirmations_no: 0,
      status_history: [{ status: rest.status, at: minsAgo(ageMins) }],
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
