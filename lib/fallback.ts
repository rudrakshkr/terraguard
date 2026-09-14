/**
 * Heuristic fallback "engine".
 *
 * When no API key is configured (or the LLM call fails), this deterministic
 * keyword classifier produces a complete IncidentAnalysis so the entire
 * workflow — analysis → RAG grounding → report → dashboard — still works.
 * It is intentionally transparent: the UI labels such analyses as
 * "heuristic mode".
 */

import type { IncidentAnalysis, IncidentType, Severity } from "./types";

const TYPE_RULES: { type: IncidentType; words: string[] }[] = [
  { type: "Rockfall", words: ["rockfall", "rock fall", "rockslide", "rocks falling", "rocks fell", "rocks have fallen", "rocks covering", "rocks on the road", "stones falling", "boulder", "loose rock", "rock"] },
  { type: "Landslide", words: ["landslide", "land slide", "mudslide", "debris slide", "slope gave", "hillside", "hill came", "slipped", "mud and debris", "debris has come", "down the slope", "slope"] },
  { type: "Flash Flood", words: ["flash flood", "rising water", "water rising", "water has started rising", "started rising", "rising very fast", "rising fast", "water level is rising", "muddy water", "turned muddy", "rain upstream", "swollen", "cloudburst", "cloud burst", "river overflow", "riverside", "surge"] },
  { type: "Flood", words: ["flood", "inundat", "waterlog", "submerged", "overflowing drain"] },
  { type: "Road Blockage", words: ["road blocked", "road is blocked", "blockage", "road closed", "closed the road", "traffic stuck", "path blocked", "obstruct"] },
  { type: "Forest Fire", words: ["forest fire", "wildfire", "bush fire", "smoke from", "burning trees", "flames on the hill", "fire spreading"] },
  { type: "Avalanche", words: ["avalanche", "snow slide", "snow wall"] },
  { type: "Building Damage", words: ["building", "house collapse", "collapsed house", "cracked wall", "walls cracked", "roof collapse", "structure damage", "debris on house"] },
];

const CRITICAL_WORDS = ["trapped", "buried", "casualt", "death", "died", "injur", "washed away", "swept away", "missing", "collapse on", "people under", "vehicle fell", "bus fell"];
const HIGH_WORDS = ["blocked", "rising", "spreading", "heavy rain", "continuous rain", "night", "tourist", "stranded", "crack", "dangerous", "near river", "close to river", "steep"];

const PLAYBOOK: Record<IncidentType, Pick<IncidentAnalysis, "immediate_actions" | "avoid" | "recommended_response"> & { risk: string[] }> = {
  Landslide: {
    immediate_actions: [
      "Move people uphill and away from the slide zone immediately",
      "Mark and cordon the affected stretch; stop vehicle movement",
      "Alert local administration and the nearest police station",
      "Watch for fresh cracks or rumbling sounds on the slope",
    ],
    avoid: [
      "Do not cross the debris flow on foot or by vehicle",
      "Avoid standing below unstable slopes or cut hillsides",
      "Do not return to collect belongings until the slope is declared stable",
    ],
    recommended_response:
      "Dispatch a patrol to confirm the blockage extent, divert traffic via an alternate route, and request the PWD/SDRF for debris clearance. Keep residents above the slide zone informed.",
    risk: ["Unstable slope material", "Continued rainfall weakening the hillside", "Vehicles stuck behind the blockage"],
  },
  Rockfall: {
    immediate_actions: [
      "Stop traffic at a safe distance from the falling-rock zone",
      "Clear bystanders from overhang and cliff base areas",
      "Report the exact chainage/landmark to highway authorities",
      "Check for vehicles hit or trapped by falling rocks",
    ],
    avoid: [
      "Do not attempt to move large boulders manually",
      "Avoid parking below cliffs or overhangs",
      "Do not walk across rock debris without checking for further falls",
    ],
    recommended_response:
      "Deploy traffic control at both ends, request NH/PWD rock-clearance machinery, and inspect the slope for loose overhang before reopening.",
    risk: ["Loose rock overhang above the road", "Vibration from traffic triggering further falls", "Poor visibility around the bend"],
  },
  "Flash Flood": {
    immediate_actions: [
      "Move everyone to higher ground immediately",
      "Cut power supply to affected low-lying structures if safe",
      "Warn camps/homestays along the riverbank upstream and downstream",
      "Establish contact with anyone stranded across the water",
    ],
    avoid: [
      "Never attempt to cross rising water on foot or by vehicle",
      "Do not camp or park within the river's flood margin",
      "Avoid returning for belongings left in the flood path",
    ],
    recommended_response:
      "Issue an immediate local alert along the river, move tourists and locals to designated shelters, and coordinate with the SDRF for any rescue.",
    risk: ["Rapidly rising river level", "Tourists near the riverbank", "Logjam or debris dam upstream"],
  },
  Flood: {
    immediate_actions: [
      "Shift residents and stock from ground floors to higher levels",
      "Divert traffic away from submerged stretches",
      "Keep drainage channels and culverts clear where safe",
      "Warn downstream settlements about the incoming flow",
    ],
    avoid: [
      "Do not drive through standing water of unknown depth",
      "Avoid contact with floodwater (contamination, live wires)",
    ],
    recommended_response:
      "Open shelters, deploy pumps/boat teams if needed, and monitor the river gauge until levels recede below the warning mark.",
    risk: ["Prolonged waterlogging", "Damage to road foundations", "Contaminated water sources"],
  },
  "Road Blockage": {
    immediate_actions: [
      "Place warning signage at both approaches to the blockage",
      "Estimate the obstruction length and number of stranded vehicles",
      "Inform the local administration and traffic police",
      "Provide water/food to stranded travellers for long waits",
    ],
    avoid: [
      "Do not force vehicles through narrow cleared gaps",
      "Avoid unverified shortcuts on unstable hill roads",
    ],
    recommended_response:
      "Coordinate with PWD/BRO for clearance machinery, publish an alternate route, and update stranded commuters at regular intervals.",
    risk: ["Long queue of stranded vehicles", "Single-road dependency of nearby villages", "Risk of secondary slope failure at the site"],
  },
  "Forest Fire": {
    immediate_actions: [
      "Report the fire's location and spread direction immediately",
      "Evacuate settlements downwind of the fire line",
      "Create control lines/ cleared strips if trained personnel are present",
    ],
    avoid: [
      "Do not attempt to outrun a fire uphill — move across/ downhill",
      "Avoid dry grass and deodar slopes during high winds",
    ],
    recommended_response:
      "Alert the Forest Department fire crew, prepare nearby villages for evacuation, and monitor wind direction until the line is contained.",
    risk: ["Wind-driven spread toward habitation", "Dry pine-needle litter acting as fuel", "Smoke reducing visibility on highways"],
  },
  Avalanche: {
    immediate_actions: [
      "Close the avalanche-prone route immediately",
      "Move shelters/camps out of the runout zone",
      "Contact the nearest avalanche warning centre",
    ],
    avoid: [
      "Do not travel on or below fresh snow slopes after heavy snowfall",
      "Avoid loud noise or vibrations in the release zone",
    ],
    recommended_response:
      "Keep the route closed until clearance is announced, and coordinate search operations only with trained rescue teams.",
    risk: ["Fresh snow loading on steep slopes", "Settlements in the runout path"],
  },
  "Building Damage": {
    immediate_actions: [
      "Evacuate the structure and cordon a safe perimeter",
      "Turn off gas, electricity, and water connections if safe",
      "Account for all residents; search only after the structure is declared safe",
    ],
    avoid: [
      "Do not enter cracked or leaning buildings",
      "Avoid adding load to damaged floors",
    ],
    recommended_response:
      "Request a structural assessment by the local tehsil/municipal engineer and arrange temporary shelter for displaced families.",
    risk: ["Progressive structural collapse", "Heavy rainfall adding load to damaged roofs"],
  },
  Other: {
    immediate_actions: [
      "Move people to a safe location away from the hazard",
      "Record clear photos and an accurate description",
      "Notify the local administration with the location details",
    ],
    avoid: ["Do not approach the hazard to inspect it closely"],
    recommended_response:
      "Request an on-site assessment by local authorities and follow their instructions until the situation is cleared.",
    risk: ["Situation still developing", "Limited on-site information"],
  },
};

function detectType(text: string): { type: IncidentType; matched: boolean } {
  const t = text.toLowerCase();
  for (const rule of TYPE_RULES) {
    if (rule.words.some((w) => t.includes(w))) return { type: rule.type, matched: true };
  }
  return { type: "Other", matched: false };
}

/**
 * Build "Why this severity?" bullets from the actual evidence: the report
 * wording, the matched type playbook risks, and severity modifiers found in
 * the text. No per-scenario hard-coding.
 */
export function buildSeverityReasons(
  text: string,
  type: IncidentType,
  severity: Severity,
  risk: string[],
): string[] {
  const t = text.toLowerCase();
  const reasons: string[] = [];
  const add = (s: string) => {
    if (reasons.length < 5 && !reasons.includes(s)) reasons.push(s);
  };

  if (CRITICAL_WORDS.some((w) => t.includes(w))) add("Report wording indicates people may be directly endangered");
  if (/(trapped|stranded|stuck)/.test(t)) add("People or vehicles potentially exposed at the site");
  if (/(blocked|blockage|closed)/.test(t)) add("Access route reported blocked or restricted");
  if (/(rain|raining|shower)/.test(t)) add("Active rainfall reported in the area");
  if (/(rising|muddy|swollen|cloudburst)/.test(t)) add("Water level or flow behaviour reported as dangerous");
  if (/(night|dark|evening)/.test(t)) add("Low visibility complicates assessment and response");
  if (/(tourist|visitors)/.test(t)) add("Visitors unfamiliar with local hazards may be involved");
  for (const r of risk.slice(0, 3)) add(r);
  if (reasons.length === 0) add(`Classified as ${type} with no aggravating evidence in the report`);
  if (severity === "Low") add("No indicators of immediate danger to people or access routes");
  return reasons.slice(0, 5);
}

function detectSeverity(text: string, type: IncidentType): Severity {
  const t = text.toLowerCase();
  if (CRITICAL_WORDS.some((w) => t.includes(w))) return "Critical";
  const block = ["blocked", "rising", "blocked the road", "closed"].some((w) => t.includes(w));
  const high = HIGH_WORDS.some((w) => t.includes(w));
  if (block || high) return type === "Flash Flood" ? "Critical" : "High";
  if (t.length > 40) return "Moderate";
  return "Low";
}

export function heuristicAnalysis(text: string, hasImage: boolean): IncidentAnalysis {
  const { type } = detectType(text || "incident reported");
  const severity = detectSeverity(text, type);
  const book = PLAYBOOK[type];
  const t = (text || "").toLowerCase();

  const risk = [...book.risk];
  if (t.includes("rain")) risk.push("Active rainfall destabilising the area");
  if (t.includes("night") || t.includes("dark")) risk.push("Reduced visibility for responders");
  if (t.includes("tourist")) risk.push("Tourists unfamiliar with local hazard protocols");
  if (hasImage) risk.push("Image evidence attached — verify extent before clearance");

  // NOTE: callers pass the description (+ optionally structured context) for
  // classification. The summary defaults to the text but callers should
  // override it with the reporter's description alone (see lib/hillsense.ts).
  const summary =
    (text || "").trim().slice(0, 220) ||
    `${type} reported${hasImage ? " with image evidence" : ""}.`;

  // Evidence too weak to classify confidently → say so instead of guessing.
  const matched = detectType(text || "").matched;
  const weak = !matched && !hasImage;

  return {
    incident_type: type,
    severity,
    // Confidence reflects signal quality: a clearly matched hazard type is a
    // strong lexical signal even in heuristic mode (UI shows bands, not %).
    confidence: hasImage ? 0.68 : matched ? 0.72 : 0.5,
    summary,
    risk_factors: risk.slice(0, 5),
    immediate_actions: book.immediate_actions,
    avoid: book.avoid,
    recommended_response: book.recommended_response,
    requires_urgent_attention: severity === "Critical" || severity === "High",
    severity_reasons: buildSeverityReasons(text || "", type, severity, risk),
    needs_verification: weak,
    ...(weak ? { verification_note: "Heuristic engine could not match a specific incident type from the description. Human/on-site verification is recommended before acting on this classification." } : {}),
  };
}
