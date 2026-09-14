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
import type { IncidentAnalysis, IncidentType, RagAnswer, Severity } from "./types";

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
  "requires_urgent_attention": boolean (true for Critical or life-threatening situations)
}

Severity guide:
- Critical: people trapped/injured/missing, structural collapse, violent flash flood, fire near habitation
- High: roads fully blocked, fast-developing hazards, tourists at risk
- Moderate: partial blockages, damage but no immediate danger to life
- Low: minor events, passable hazards, informational reports

If the image shows a hazard scene, weigh what is visible (debris extent, water level, fire line, damage) together with the text. If text and image disagree, prefer the image and lower confidence.

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
  };
}

export interface AnalyzeInput {
  text: string;
  imageBase64?: string | null; // data URL or raw base64
  k?: number; // RAG hits to retrieve
}

export interface AnalyzeResult {
  analysis: IncidentAnalysis;
  sources: RagHit[];
  aiAvailable: boolean;
  grounded: boolean;
}

/** Full incident pipeline: retrieve → classify → ground → merge. */
export async function analyzeIncident(input: AnalyzeInput): Promise<AnalyzeResult> {
  const text = (input.text || "").trim();
  const hasImage = Boolean(input.imageBase64);
  const k = input.k ?? 4;

  // 1. RAG retrieval (always runs — also powers the sources panel).
  const { hits } = await retrieve(text || "mountain disaster safety", k);

  // 2. Heuristic baseline — always available, replaced by AI when possible.
  const base = heuristicAnalysis(text, hasImage);
  if (!aiAvailable()) {
    return { analysis: base, sources: hits, aiAvailable: false, grounded: false };
  }

  // 3. Multimodal classification pass.
  const userContent: string = [
    text ? `REPORT: ${text}` : "REPORT: (no text provided, image only)",
    "Classify this report now as JSON.",
  ].join("\n");

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
    return { analysis: base, sources: hits, aiAvailable: false, grounded: false };
  }

  // 4. Grounded recommendation pass (only if AI is alive).
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

  return {
    analysis: { ...classification, ...actions },
    sources: hits,
    aiAvailable: true,
    grounded,
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
            .join("\n\n")}\n\nFor life-threatening situations, call 112.`
        : "The language model could not be reached and no knowledge-base passages matched. For life-threatening situations, call 112.",
      sources: hits,
      aiAvailable: false,
    };
  }

  return { answer, sources: hits, aiAvailable: true };
}
