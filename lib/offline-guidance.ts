/**
 * Offline safety guidance — a small, curated emergency library bundled with
 * the app so it works with no connectivity.
 *
 * Content is distilled from the same sample knowledge base that powers the
 * online Ask pipeline (knowledge-base/*.md) — no invented advice, and every
 * topic carries the same "sample reference material" caveat. The UI must
 * present it as "Cached safety guidance", never as live or official
 * government information.
 */

export interface OfflineGuidanceTopic {
  id: string;
  title: string;
  keywords: string[]; // matched against the user's question (lowercase)
  /** Short intro shown before the lists. */
  intro: string;
  warning_signs?: string[];
  immediate_actions: string[];
  avoid?: string[];
}

export const OFFLINE_GUIDANCE: OfflineGuidanceTopic[] = [
  {
    id: "landslide",
    title: "Landslide safety",
    keywords: ["landslide", "slope", "mudslide", "debris slide", "hillside", "hill side", "earth movement"],
    intro:
      "Landslides in the Himalayan belt are most dangerous during and after prolonged rain, when slopes are saturated.",
    warning_signs: [
      "New cracks or unusual bulges on slopes or roads",
      "Tilting trees, fences, or poles",
      "Rumbling or popping sounds from the hillside",
      "Sudden muddy seepage or springs appearing on a slope",
      "Small rock or debris falls preceding larger movement",
    ],
    immediate_actions: [
      "Move uphill or to higher stable ground, away from the slide path",
      "Warn people below the slope — debris travels far downhill",
      "Do not return to a building under a slope until it is declared safe",
      "Stay off the debris mass; secondary slides are common after the first movement",
      "Notify local emergency services and follow district authorities' instructions",
    ],
    avoid: [
      "Do not cross or stand on fresh slide debris",
      "Do not build shelter at the base of a steep slope",
      "Avoid river channels carrying slide debris",
    ],
  },
  {
    id: "flash-flood",
    title: "Flash flood safety",
    keywords: ["flash flood", "flood", "cloudburst", "cloudbursts", "rising water", "nala", "river", "swollen"],
    intro:
      "Flash floods develop within minutes to hours of intense rain, often far from where the rain falls. A dry nala can become a violent torrent with little local warning.",
    warning_signs: [
      "Rapidly rising or suddenly muddy water in rivers and streams",
      "A low rumble or deep growl coming from upstream",
      "Debris, twigs, or fresh silt suddenly floating past",
      "Intense rainfall over the hills upstream of your position",
    ],
    immediate_actions: [
      "Move immediately to higher ground — never wait to see if the water rises further",
      "Leave low-lying camps, riverbeds, and parking areas at once",
      "Follow marked evacuation routes and keep family members together",
      "Notify local emergency services once you are safe, and follow district authorities' instructions",
    ],
    avoid: [
      "Never try to walk or drive through moving floodwater",
      "Do not camp beside rivers or nalas during rain upstream",
      "Avoid returning to a flooded area while water is still high",
    ],
  },
  {
    id: "rockfall",
    title: "Rockfall safety",
    keywords: ["rockfall", "rock fall", "falling rock", "rocks falling", "boulder", "rock slide"],
    intro:
      "Rockfall zones are usually known and signposted; risk rises with rain, freeze–thaw, and road-cut blasting.",
    warning_signs: [
      "Piles of fresh rock rubble at the base of a slope",
      "Dust plumes rising from a cliff face",
      "Cracking or popping sounds above",
      "Warning boards along the road",
    ],
    immediate_actions: [
      "Move quickly away from the fall zone — look up before you move",
      "Stay inside a vehicle only if it is clear of the zone; leave it if rocks are striking nearby",
      "Warn others approaching the zone",
      "Notify local authorities or road maintenance crews once clear",
    ],
    avoid: [
      "Do not stop or park below overhanging rock faces",
      "Do not try to dislodge loose rocks yourself",
    ],
  },
  {
    id: "road-blockage",
    title: "Road blockage response",
    keywords: ["road blocked", "road blockage", "blocked road", "stranded", "clearance", "obstruction", "tree fallen", "route closed"],
    intro:
      "Blocked mountain roads strand travellers quickly; stay with your vehicle where it is visible and safe.",
    immediate_actions: [
      "Stop in a safe, visible spot — avoid stopping on slopes or below overhangs",
      "Stay with your vehicle if conditions are stable; it shelters you and is easier to spot",
      "Conserve phone battery; notify local emergency services and share your location",
      "Follow district authorities' instructions and official clearance updates",
    ],
    avoid: [
      "Do not attempt to cross a fresh slide or washed-out section on foot",
      "Do not take unmarked shortcuts on unstable slopes",
    ],
  },
  {
    id: "evacuation",
    title: "Evacuation & general emergency",
    keywords: ["evacuat", "emergency", "prepare", "preparedness", "go bag", "kit", "warning", "alert", "siren", "trapped", "injured", "missing"],
    intro:
      "When authorities announce evacuation or a hazard is developing, leave early — delaying is the biggest risk.",
    immediate_actions: [
      "Take your emergency kit: water, medicines, documents, torch, power bank, warm layer",
      "Switch off electricity and gas at the mains if it is safe to do so",
      "Follow the marked evacuation route; help neighbours who need assistance",
      "Call 112 in a life-threatening emergency; notify local emergency services and follow district authorities' instructions",
      "Do not re-enter the area until authorities declare it safe",
    ],
    avoid: [
      "Do not wait to collect belongings after the order to leave",
      "Avoid riverbanks, bridges, and steep slopes on the way out",
    ],
  },
];

/** Match a question to the most relevant cached topic (keyword overlap count). */
export function matchOfflineTopic(question: string): OfflineGuidanceTopic | null {
  const q = (question || "").toLowerCase();
  if (!q.trim()) return null;
  let best: { topic: OfflineGuidanceTopic; score: number } | null = null;
  for (const topic of OFFLINE_GUIDANCE) {
    let score = 0;
    for (const kw of topic.keywords) if (q.includes(kw)) score += kw.includes(" ") ? 2 : 1;
    if (score > 0 && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic ?? null;
}

/** Default answer when no topic matches — still useful, still honest. */
export function offlineFallbackAnswer(): OfflineGuidanceTopic {
  return {
    id: "general",
    title: "General mountain emergency guidance",
    keywords: [],
    intro:
      "No cached topic matched this question exactly. Here is general emergency guidance for mountain regions:",
    immediate_actions: [
      "Move to open ground away from steep slopes, rivers, and bridges",
      "Call 112 in a life-threatening emergency",
      "Notify local emergency services and follow district authorities' instructions",
      "Keep your phone charged and conserve battery",
      "Stay informed via battery radio if available; help others nearby who may need assistance",
    ],
    avoid: ["Do not return to an affected area until it is declared safe"],
  };
}

/** Render a topic as the plain-text answer shown in the Ask thread. */
export function formatOfflineAnswer(topic: OfflineGuidanceTopic): string {
  const lines: string[] = [topic.intro, ""];
  if (topic.warning_signs?.length) {
    lines.push("Warning signs:", ...topic.warning_signs.map((s) => `• ${s}`), "");
  }
  lines.push("What to do:", ...topic.immediate_actions.map((s) => `• ${s}`));
  if (topic.avoid?.length) {
    lines.push("", "Avoid:", ...topic.avoid.map((s) => `• ${s}`));
  }
  lines.push(
    "",
    "For life-threatening emergencies, call 112. Cached safety guidance works without internet — it is not live information.",
  );
  return lines.join("\n");
}
