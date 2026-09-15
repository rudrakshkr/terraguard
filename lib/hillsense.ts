/**
 * AI orchestration — the heart of HillSense.
 *
 * Incident flow:
 *   text/image → RAG retrieval → multimodal LLM classification
 *   → grounded recommendation pass → merged structured analysis
 *
 * Ask-HillSense flow:
 *   question → RAG retrieval → cited answer
 *
 * Every LLM call fails soft to the deterministic heuristic engine, so the
 * whole product remains demonstrable without an API key.
 */

import { chatJSON, chatText, aiAvailable } from "./llm";
import { heuristicAnalysis } from "./fallback";
import { retrieve, contextBlock, type RagHit } from "./rag";
import { verifyReport, type VerificationResult } from "./verification";
import { listIncidents } from "./store";
import type {
  EvidenceLink,
  IncidentAnalysis,
  IncidentType,
  PipelineTimings,
  RagAnswer,
  Severity,
} from "./types";

const VALID_TYPES: IncidentType[] = [
  "Landslide", "Rockfall", "Flood", "Flash Flood", "Road Blockage",
  "Building Damage", "Forest Fire", "Avalanche", "Other",
];
const VALID_SEVERITIES: Severity[] = ["Critical", "High", "Moderate", "Low"];

const CLASSIFIER_SYSTEM = `You are HillSense AI, a disaster-intelligence assistant for hilly and mountainous regions of Himachal Pradesh, India.
You classify citizen disaster reports. You are decision support, NOT an authoritative emergency service — never issue medical, legal, or life-or-death instructions.

Classify the user's report (text, and image if provided) into JSON with EXACTLY these fields:
{
  "incident_type": one of "Landslide" | "Rockfall" | "Flood" | "Flash Flood" | "Road Blockage" | "Building Damage" | "Forest Fire" | "Avalanche" | "Other",
  "severity": one of "Critical" | "High" | "Moderate" | "Low",
  "confidence": number 0..1 (your classification confidence),
  "summary": one or two sentence factual summary of the situation,
  "risk_factors": array of 2-5 short strings describing current or imminent dangers,
  "severity_reasons": array of 2-5 short strings, each a concrete observed fact that justifies the severity (e.g. "road fully blocked", "people exposed at the site"),
  "needs_verification": boolean — true when evidence is weak, the image is unclear, or text and image contradict each other; in that case avoid a confident severity call,
  "verification_note": short string explaining what needs on-site verification (only when needs_verification is true),
  "requires_urgent_attention": boolean (true for Critical or life-threatening situations)
}

If the report includes an image, also judge consistency: when the image does NOT show the hazard described in the text, set confidence below 0.4, set needs_verification to true, and explain the mismatch in verification_note.

Severity guide:
- Critical: people trapped/injured/missing, structural collapse, violent flash flood, fire near habitation
- High: roads fully blocked, fast-developing hazards, tourists at risk
- Moderate: partial blockages, damage but no immediate danger to life
- Low: minor events, passable hazards, informational reports

If the image shows a hazard scene, weigh what is visible (debris extent, water level, fire line, damage) together with the text. If text and image disagree, prefer the image and lower confidence.

The "summary" field must describe the situation in the reporter's own words — never restate the REPORTER-PROVIDED DETAILS (hazard type, when, affected, etc.) inside the summary.

If the REPORT text is gibberish, random characters, or has no recognizable relation to any disaster topic, classify honestly: set incident_type to "Other", set confidence to 0.1, set needs_verification to true, and explain in verification_note that the description is not readable. Never invent details to fill missing content.

Respond with JSON only.`;

const GROUNDED_SYSTEM = `You are HillSense AI, a disaster-response advisor for mountain regions. You are decision support, NOT an authoritative emergency service.

You will receive a classified incident and retrieved reference passages. Using ONLY the guidance implied by those passages and standard disaster-response practice:
{
  "immediate_actions": 3-5 short imperative steps for the reporter/on-site responders,
  "avoid": 2-4 short things to avoid,
  "recommended_response": 2-3 sentences describing how local authorities/SDRF/PWD would typically respond
}

Stay consistent with the incident's type and severity. Be concrete to hilly terrain (slopes, nalas, cut roads, riverbanks). Do not invent statistics, medical advice, or official orders.

Respond with JSON only.`;

const ASK_SYSTEM = `You are HillSense AI, an assistant that answers disaster-safety questions for people in the mountains of Himachal Pradesh.

Answer the user's question using the provided reference passages. Rules:
- Ground your answer in the passages; do not invent facts, statistics, or official orders.
- Be practical and specific to hilly terrain.
- Keep it under 200 words, plain sentences, no markdown headings.
- You are decision support, not an authoritative emergency service; for life-threatening situations, say to call 112.
- End with a line "Sources: 1, 2" listing the passage numbers you used.

Respond with plain text only.`;

function coerceAnalysis(raw: unknown, text: string): IncidentAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = VALID_TYPES.includes(r.incident_type as IncidentType)
    ? (r.incident_type as IncidentType)
    : null;
  const severity = VALID_SEVERITIES.includes(r.severity as Severity)
    ? (r.severity as Severity)
    : null;
  if (!type || !severity) return null;

  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

  const confidence = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.6;
  const needsVerification = r.needs_verification === true;

  return {
    incident_type: type,
    severity,
    confidence,
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : text.slice(0, 220),
    risk_factors: strArr(r.risk_factors),
    immediate_actions: strArr(r.immediate_actions),
    avoid: strArr(r.avoid),
    recommended_response: typeof r.recommended_response === "string" ? r.recommended_response : "",
    requires_urgent_attention:
      typeof r.requires_urgent_attention === "boolean"
        ? r.requires_urgent_attention
        : severity === "Critical" || severity === "High",
    severity_reasons: strArr(r.severity_reasons),
    needs_verification: needsVerification,
    ...(needsVerification && typeof r.verification_note === "string"
      ? { verification_note: r.verification_note }
      : {}),
  };
}

/** Incident-specific retrieval queries — far better than a generic safety query. */
const TYPE_QUERIES: Record<IncidentType, string> = {
  Landslide: "landslide warning signs slope movement debris immediate actions",
  Rockfall: "rockfall falling rocks road secondary falls clearance safety",
  "Flash Flood": "flash flood rising river water high ground camping safety",
  Flood: "flood waterlogging safety evacuation submerged roads",
  "Road Blockage": "road blockage clearance stranded travellers machinery safety",
  "Building Damage": "building damage structural cracks evacuation assessment",
  "Forest Fire": "forest fire wildfire spread evacuation wind control lines",
  Avalanche: "avalanche snow slope closure runout zone safety",
  Other: "disaster safety preparedness reporting emergency",
};

function buildRagQuery(a: { incident_type: IncidentType; summary: string; risk_factors: string[] }, reportText: string): string {
  const parts = [TYPE_QUERIES[a.incident_type]];
  const context = (reportText.trim() || a.summary || "").trim();
  if (context) parts.push(context.slice(0, 240));
  return parts.join(" ");
}

/**
 * Pair each key recommendation with the retrieved passages whose wording
 * supports it (lexical overlap). Purely presentation-level attribution.
 */
function linkEvidence(analysis: IncidentAnalysis, sources: RagHit[]): EvidenceLink[] {
  const claims = [
    ...analysis.immediate_actions.slice(0, 4),
    ...(analysis.recommended_response ? [analysis.recommended_response] : []),
  ];
  return claims
    .map((claim) => {
      const words = new Set(
        claim
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 4),
      );
      const refs: number[] = [];
      sources.forEach((s, i) => {
        const hay = `${s.title} ${s.excerpt}`.toLowerCase();
        let overlap = 0;
        for (const w of words) if (hay.includes(w)) overlap++;
        if (overlap >= 2) refs.push(i);
      });
      return { claim, refs: refs.slice(0, 2) };
    })
    .filter((e) => e.refs.length > 0);
}

export interface AnalyzeInput {
  text: string;
  imageBase64?: string | null; // data URL or raw base64
  /** Structured reporter context (hazard type, when, affected, observations…). */
  context?: string;
  /** Reporter-declared hazard type, used for type-consistency checks. */
  hazardType?: string;
  /** Reporter coordinates, used for location checks. */
  location?: { lat: number; lng: number };
  k?: number; // RAG hits to retrieve
}

export interface AnalyzeResult {
  analysis: IncidentAnalysis;
  sources: RagHit[];
  evidence: EvidenceLink[];
  aiAvailable: boolean;
  grounded: boolean;
  query_used: string;
  timings: PipelineTimings;
  verification: VerificationResult;
}

/** Find active incidents near the new report for duplicate/corroboration checks. */
async function nearbyContext(input: { location?: { lat: number; lng: number }; hazardType?: string }): Promise<
  { incident: import("./types").Incident; distanceKm: number; minutesApart: number }[]
> {
  try {
    const all = await listIncidents();
    const now = Date.now();
    return all
      .filter((i) => i.status !== "Resolved" && i.verification !== "rejected")
      .map((i) => ({
        incident: i,
        distanceKm:
          input.location
            ? Math.hypot((i.lat - (input.location.lat ?? 0)) * 111, (i.lng - (input.location.lng ?? 0)) * 91)
            : 999,
        minutesApart: Math.abs(now - new Date(i.created_at).getTime()) / 60000,
      }))
      .filter((r) => r.distanceKm <= 10 && r.minutesApart <= 24 * 60)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Full incident pipeline (v2):
 *   input → multimodal classification → query construction
 *   → incident-specific RAG retrieval → grounded recommendations → merge
 *
 * Retrieval happens AFTER classification so image-only reports get
 * incident-specific guidance instead of generic "mountain disaster safety".
 */
export async function analyzeIncident(input: AnalyzeInput): Promise<AnalyzeResult> {
  const t0 = Date.now();
  const text = (input.text || "").trim();
  const hasImage = Boolean(input.imageBase64);
  const k = input.k ?? 4;
  const timings: PipelineTimings = { totalMs: 0 };

  // Enriched text: description + structured reporter context.
  const fullText = [text, input.context].filter(Boolean).join("\n\n");

  // 1. Heuristic baseline — always available, replaced by AI when possible.
  //    Classification may consider the structured context (it contains useful
  //    hazard keywords), but the SUMMARY must stay in the reporter's own words.
  const base = heuristicAnalysis(fullText, hasImage);
  if (text) base.summary = text.slice(0, 220);
  else if (hasImage) base.summary = `${base.incident_type} reported with image evidence.`;
  const nearby = await nearbyContext(input);

  const runVerification = (analysis: IncidentAnalysis, ai: boolean): VerificationResult =>
    verifyReport({
      analysis,
      aiAvailable: ai,
      hasImage,
      hasText: Boolean(text),
      text,
      hazardType: input.hazardType,
      context: input.context,
      location: input.location,
      nearby,
    });

  if (!aiAvailable()) {
    // Heuristic mode: retrieve with the rule-matched type + report text.
    const r0 = Date.now();
    const query = buildRagQuery(base, fullText);
    const { hits } = await retrieve(query, k);
    timings.retrievalMs = Date.now() - r0;
    timings.totalMs = Date.now() - t0;
    return {
      analysis: base,
      sources: hits,
      evidence: linkEvidence(base, hits),
      aiAvailable: false,
      grounded: false,
      query_used: query,
      timings,
      verification: runVerification(base, false),
    };
  }

  // 2. Multimodal classification pass.
  const userContent: string = [
    text ? `REPORT: ${text}` : "REPORT: (no text provided, image only)",
    input.context ? `REPORTER-PROVIDED DETAILS:\n${input.context}` : "",
    "Classify this report now as JSON.",
  ].filter(Boolean).join("\n");

  const parts: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] = [
    { type: "text", text: userContent },
  ];
  if (hasImage) {
    const url = input.imageBase64!.startsWith("data:")
      ? input.imageBase64!
      : `data:image/jpeg;base64,${input.imageBase64}`;
    parts.push({ type: "image_url", image_url: { url } });
  }

  const classified = await chatJSON<unknown>([
    { role: "system", content: CLASSIFIER_SYSTEM },
    { role: "user", content: parts },
  ]);

  const classification = coerceAnalysis(classified, text);
  if (!classification) {
    // LLM failed or returned unusable JSON — deterministic fallback keeps demo alive.
    const r0 = Date.now();
    const query = buildRagQuery(base, fullText);
    const { hits } = await retrieve(query, k);
    timings.retrievalMs = Date.now() - r0;
    timings.totalMs = Date.now() - t0;
    return {
      analysis: base,
      sources: hits,
      evidence: linkEvidence(base, hits),
      aiAvailable: false,
      grounded: false,
      query_used: query,
      timings,
      verification: runVerification(base, false),
    };
  }
  timings.classificationMs = Date.now() - t0;

  // 3. Construct an incident-specific RAG query FROM the classification.
  const r0 = Date.now();
  const query = buildRagQuery(classification, fullText);
  const { hits } = await retrieve(query, k);
  timings.retrievalMs = Date.now() - r0;

  // 4. Grounded recommendation pass.
  const g0 = Date.now();
  let actions = {
    immediate_actions: base.immediate_actions,
    avoid: base.avoid,
    recommended_response: base.recommended_response,
  };
  let grounded = false;
  const ctx = contextBlock(hits);
  if (ctx) {
    const groundedOut = await chatJSON<{
      immediate_actions?: unknown;
      avoid?: unknown;
      recommended_response?: unknown;
    }>([
      { role: "system", content: GROUNDED_SYSTEM },
      {
        role: "user",
        content: [
          `REFERENCE PASSAGES:\n${ctx}`,
          "",
          `INCIDENT: type=${classification.incident_type}, severity=${classification.severity}`,
          `Summary: ${classification.summary}`,
          `Risk factors: ${classification.risk_factors.join("; ")}`,
          `Evidence supporting severity: ${classification.severity_reasons?.join("; ") ?? "n/a"}`,
          "",
          "Produce the grounded actions JSON now.",
        ].join("\n"),
      },
    ]);
    if (groundedOut) {
      const strArr = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
          : [];
      const ga = strArr(groundedOut.immediate_actions);
      const gav = strArr(groundedOut.avoid);
      if (ga.length > 0 || gav.length > 0 || typeof groundedOut.recommended_response === "string") {
        actions = {
          immediate_actions: ga.length ? ga : actions.immediate_actions,
          avoid: gav.length ? gav : actions.avoid,
          recommended_response:
            typeof groundedOut.recommended_response === "string" && groundedOut.recommended_response.trim()
              ? groundedOut.recommended_response
              : actions.recommended_response,
        };
        grounded = true;
      }
    }
  }
  timings.groundingMs = Date.now() - g0;
  timings.totalMs = Date.now() - t0;

  // Low model confidence should also trigger the verification flag.
  const needsVerification = classification.needs_verification || classification.confidence < 0.5;

  const analysis: IncidentAnalysis = {
    ...classification,
    ...actions,
    needs_verification: needsVerification,
    ...(needsVerification && !classification.verification_note
      ? { verification_note: "Model confidence was low — verify on site or request confirmation from a second reporter." }
      : {}),
  };

  return {
    analysis,
    sources: hits,
    evidence: linkEvidence(analysis, hits),
    aiAvailable: true,
    grounded,
    query_used: query,
    timings,
    verification: runVerification(analysis, true),
  };
}

/** Ask HillSense: RAG-grounded Q&A with visible sources. */
export async function askHillSense(question: string): Promise<RagAnswer> {
  const q = (question || "").trim();
  const { hits } = await retrieve(q || "disaster safety", 5);

  if (!aiAvailable()) {
    // No AI: return the most relevant passages directly, honestly labelled.
    const digest = hits
      .slice(0, 3)
      .map((h, i) => `${i + 1}. ${h.title} — ${h.excerpt}`)
      .join("\n\n");
    return {
      answer: hits.length
        ? `HillSense is running without its language model right now, so here are the most relevant passages from the knowledge base:\n\n${digest}\n\nFor life-threatening situations, call 112.`
        : "HillSense is running without its language model right now and no matching knowledge-base passages were found. For life-threatening situations, call 112.",
      sources: hits,
      aiAvailable: false,
    };
  }

  const ctx = contextBlock(hits);
  const answer = await chatText(
    [
      { role: "system", content: ASK_SYSTEM },
      {
        role: "user",
        content: ctx
          ? `REFERENCE PASSAGES:\n${ctx}\n\nQUESTION: ${q}`
          : `QUESTION: ${q}\n\n(No reference passages retrieved — answer from general disaster-safety practice and be transparent that no knowledge-base sources matched.)`,
      },
    ],
    40_000,
  );

  if (!answer) {
    return {
      answer: hits.length
        ? `The language model could not be reached. Relevant knowledge-base passages for your question:\n\n${hits
            .slice(0, 3)
            .map((h, i) => `${i + 1}. ${h.title} — ${h.excerpt}`)
            .join("\n\n")}\n\nFor life-threatening emergencies, call 112.`
        : "The language model could not be reached and no knowledge-base passages matched. For life-threatening situations, call 112.",
      sources: hits,
      aiAvailable: false,
    };
  }

  return { answer, sources: hits, aiAvailable: true };
}
