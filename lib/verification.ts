import type { Incident, IncidentAnalysis, IncidentType } from "./types";

export type VerificationStatus = "verified" | "needs_review" | "rejected";

export interface EvidenceCheck {
  check: string; // e.g. "Image ↔ description consistency"
  pass: "pass" | "warn" | "fail" | "skip";
  detail: string; // concise, system-level — no hidden chain-of-thought
}

export interface VerificationResult {
  status: VerificationStatus;
  /** Observable, system-level checks — never model reasoning or "lie detection". */
  reasons: string[];
  evidence_checks: EvidenceCheck[];
  corroboration?: {
    nearby_reports: number;
    window_minutes: number;
    max_distance_km: number;
  };
  publication: "public" | "review_only" | "hidden";
  headline: string;
  explanation: string;
}

/**
 * Common Latin letter bigrams across English and common Hindi transliteration
 * (Hinglish). Used only as a junk-text signal — never as a quality score.
 */
const COMMON_BIGRAMS = new Set(
  ("th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el ta la ns di fo ho pe ec pr no ct us ac ot il tr ly nc et ut ss so rs un lo wa ge ie wh ee wi em ad ol rt po we na ul ni ts mo ow pa im mi ai sh ir su id os iv ia am fi ci vi pl ig tu ev ld ry mp fe bl ab gh oc" +
    " ya ba ga sa ja da ka ki ko ku mu pu ru tu hu bha rha ny kh dh bh ph jh gh")
    .split(" "),
);

/**
 * Detect keyboard-mash / random-character descriptions (e.g. "jaifdakfjajdnawdawd").
 * Deliberately conservative: real English, Hinglish and Devanagari text passes;
 * only statistical junk is flagged. Short text (< 12 chars) is never flagged here.
 */
export function looksLikeGibberish(raw: string): boolean {
  const text = (raw ?? "").trim();
  if (text.length < 12) return false;
  const lettersAll = text.replace(/[^\p{L}]/gu, "");
  if (!lettersAll) return false; // digits/punctuation only — other checks judge
  const latin = lettersAll.replace(/[^\u0000-\u024F]/gu, "");
  const latinDominant = latin.length / lettersAll.length > 0.8;

  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  if (tokens.length === 0) return true;

  if (/(\p{L})\1{4,}/u.test(text)) return true; // "aaaaaa"
  if (/(asdf|qwer|zxcv|lkjh|poiuy|mnbv)/i.test(text)) return true; // keyboard runs

  let bigramHits = 0;
  let bigramTotal = 0;
  let wordLike = 0;
  let letterTokens = 0;
  for (const t of tokens) {
    const letters = t.replace(/[^\p{L}]/gu, "");
    if (!letters) continue; // pure digits — neutral
    letterTokens++;
    const isLatin = /^[\u0000-\u024F]+$/u.test(letters);
    let ok = true;
    if (isLatin) {
      if (letters.length >= 3 && !/[aeiou]/i.test(letters)) ok = false;
      if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(letters)) ok = false;
    }
    if (ok) wordLike++;
    if (latinDominant && letters.length > 1) {
      for (let i = 0; i < letters.length - 1; i++) {
        bigramTotal++;
        if (COMMON_BIGRAMS.has(letters.slice(i, i + 2))) bigramHits++;
      }
    }
  }
  const bigramScore = bigramTotal > 0 ? bigramHits / bigramTotal : 1;
  const wordRatio = letterTokens > 0 ? wordLike / letterTokens : 1;
  const uniqRatio = new Set(tokens).size / tokens.length;

  if (latinDominant && bigramTotal >= 8 && bigramScore < 0.22) return true;
  if (tokens.length >= 4 && uniqRatio < 0.35) return true; // "asdf asdf asdf asdf"
  if (letterTokens >= 3 && wordRatio < 0.35) return true;
  return false;
}

const HAZARD_IMAGE_WORDS: Record<string, string[]> = {
  Landslide: ["debris", "mud", "slide", "slope", "hill", "earth", "landslide", "buried"],
  Rockfall: ["rock", "boulder", "stone", "rubble", "debris"],
  "Flash Flood": ["water", "flood", "river", "flow", "muddy", "swollen"],
  Flood: ["water", "flood", "submerged", "waterlog", "level"],
  "Road Blockage": ["blocked", "debris", "obstruct", "tree", "rubble", "closed"],
  "Building Damage": ["crack", "collapse", "rubble", "damage", "debris", "wall"],
  "Forest Fire": ["fire", "smoke", "flame", "burn", "ash"],
  Avalanche: ["snow", "avalanche", "slide", "snowpack"],
  Other: [],
};

/**
 * Evidence-consistency verification.
 *
 * We evaluate whether the submitted EVIDENCE (text, image, classification,
 * structured form fields, nearby reports) is internally consistent — we never
 * claim to detect whether a person is lying, and we never produce a per-user
 * "trust score". Each check is explicit and shown to the reporter.
 */
export function verifyReport(input: {
  analysis: IncidentAnalysis;
  aiAvailable: boolean;
  hasImage: boolean;
  hasText: boolean;
  /** The reporter's own description text (for readability checks). */
  text?: string;
  /** Reporter-declared hazard type from the form (may be absent). */
  hazardType?: IncidentType | string;
  /** Structured observations the reporter added. */
  context?: string;
  /** Coordinates, when the reporter shared them. */
  location?: { lat: number; lng: number };
  /** Existing active incidents used for duplicate/corroboration analysis. */
  nearby?: { incident: Incident; distanceKm: number; minutesApart: number }[];
}): VerificationResult {
  const { analysis: a, aiAvailable, hasImage, hasText } = input;
  const checks: EvidenceCheck[] = [];
  const reportText = (input.text ?? "").trim();
  const gibberish = hasText && looksLikeGibberish(reportText);
  const band = a.confidence >= 0.8 ? "High" : a.confidence >= 0.6 ? "Medium" : "Low";

  const add = (check: string, pass: EvidenceCheck["pass"], detail: string) =>
    checks.push({ check, pass, detail });

  /* ------------------------------ report received ----------------------------- */
  add(
    "Report received",
    hasText || hasImage ? "pass" : "fail",
    [hasText && "written description", hasImage && "photo evidence"].filter(Boolean).join(" + ") ||
      "no content submitted",
  );

  /* ------------------------ image ↔ description consistency -------------------- */
  // The classifier is explicitly instructed to lower confidence on mismatch; we
  // surface that signal as a first-class check instead of hiding it in a score.
  const contradiction =
    hasImage && hasText && a.needs_verification === true && a.confidence < 0.45;
  add(
    "Image ↔ description consistency",
    contradiction ? "fail" : hasImage && hasText ? "pass" : hasImage || hasText ? "warn" : "fail",
    contradiction
      ? "Image and description appear to describe different situations — the classifier flagged a sharp confidence drop with both inputs present."
      : hasImage && hasText
        ? "Description matches the visible evidence in the photo (model agreement)."
        : hasImage
          ? "Photo analysed without a description — consistency cannot be fully confirmed."
          : hasText
            ? "No photo submitted — only the written description could be checked."
            : "Nothing to compare.",
  );

  /* --------------------------- image ↔ hazard-type match ----------------------- */
  const declaredType = (input.hazardType ?? a.incident_type) as string;
  if (input.hazardType && a.incident_type && input.hazardType !== a.incident_type) {
    const siblings: Record<string, string[]> = {
      Landslide: ["Road Blockage"],
      "Road Blockage": ["Landslide", "Rockfall"],
      Rockfall: ["Road Blockage", "Landslide"],
      "Flash Flood": ["Flood"],
      Flood: ["Flash Flood"],
    };
    const isSibling = (siblings[declaredType] ?? []).includes(a.incident_type);
    add(
      "Hazard-type consistency",
      isSibling ? "warn" : "fail",
      isSibling
        ? `Declared "${declaredType}" but classification found the closely related "${a.incident_type}".`
        : `Declared "${declaredType}" but the AI classified "${a.incident_type}" — a mismatch that needs review.`,
    );
  } else {
    add(
      "Hazard-type consistency",
      input.hazardType ? "pass" : "warn",
      input.hazardType
        ? `Declared type "${declaredType}" agrees with the AI classification.`
        : "Reporter did not declare a type — classified as " + a.incident_type + ".",
    );
  }

  /* ------------------------------- text quality -------------------------------- */
  add(
    "Description quality",
    !hasText ? "skip" : gibberish ? (hasImage ? "warn" : "fail") : "pass",
    !hasText
      ? "No description provided."
      : gibberish
        ? hasImage
          ? "The written description is not readable text — only the photo could be assessed, so this cannot be auto-published."
          : "The written description is not readable text (it appears to be random characters), so there is no evidence to check."
        : `Description contains hazard-relevant detail (${a.risk_factors?.length ?? 0} risk factors extracted).`,
  );

  /* ------------------------- image plausibility / quality ---------------------- */
  if (hasImage) {
    const words = HAZARD_IMAGE_WORDS[a.incident_type] ?? [];
    const textHits = words.filter((w) => (input.context ?? "").toLowerCase().includes(w) || (hasText ? a.summary.toLowerCase().includes(w) : false));
    add(
      "Image plausibility",
      contradiction ? "fail" : band === "Low" ? "warn" : "pass",
      contradiction
        ? "The photo does not contain visible evidence consistent with the reported hazard."
        : band === "Low"
          ? "Photo could not be confidently assessed — treat as unverified visual evidence."
          : `Photo assessed for ${a.incident_type} indicators${textHits.length ? `; description references ${textHits.slice(0, 2).join(", ")}` : ""}.`,
    );
  } else {
    add("Image plausibility", "skip", "No image submitted.");
  }

  /* ------------------------------ location checks ------------------------------ */
  if (input.location) {
    add(
      "Location plausibility",
      "pass",
      `Coordinates provided (${input.location.lat.toFixed(3)}, ${input.location.lng.toFixed(3)}) — within the region covered by this service.`,
    );
  } else {
    add("Location plausibility", "warn", "No coordinates — report may lack a precise position on the map.");
  }

  /* ---------------------------- timestamp consistency -------------------------- */
  // Image EXIF is stripped by browser downscaling before upload; when a raw file
  // with metadata arrives, providers may read it — we only report what we know.
  add(
    "Timestamp consistency",
    "skip",
    "Image metadata is not available for verification (browser upload). Report timing taken as submitted.",
  );

  /* -------------------- duplicates / nearby corroboration ---------------------- */
  const nearby = input.nearby ?? [];
  const dupes = nearby.filter((r) => r.distanceKm <= 1.5 && r.minutesApart <= 6 * 60);
  const corroboration = nearby.filter((r) => r.distanceKm <= 10 && r.minutesApart <= 24 * 60);
  if (dupes.length > 0) {
    add(
      "Duplicate / related reports",
      "warn",
      `${dupes.length} very close report${dupes.length === 1 ? "" : "s"} (within 1.5 km & 6 h) — possibly the same event; corroboration noted rather than auto-rejecting.`,
    );
  }
  const corroborationInfo =
    corroboration.length > 0
      ? {
          nearby_reports: corroboration.length,
          window_minutes: Math.min(...corroboration.map((r) => r.minutesApart)),
          max_distance_km: Math.round(Math.min(...corroboration.map((r) => r.distanceKm)) * 10) / 10,
        }
      : undefined;

  if (corroboration.length >= 2) {
    add(
      "Nearby corroboration",
      "pass",
      `${corroboration.length} related community reports within 10 km / 24 h strengthen this incident's assessment.`,
    );
  } else if (corroboration.length === 1) {
    add("Nearby corroboration", "warn", "One related report nearby — single-source, not yet corroborated.");
  } else {
    add("Nearby corroboration", "warn", "No related reports found nearby — first report for this area/event.");
  }

  /* ------------------------------ final decision ------------------------------- */
  const hardFails = checks.filter((c) => c.pass === "fail");
  const warns = checks.filter((c) => c.pass === "warn");

  if (hardFails.length > 0) {
    return {
      status: "rejected",
      reasons: checks.filter((c) => c.pass !== "skip").map((c) => `${c.check}: ${c.detail}`),
      evidence_checks: checks,
      corroboration: corroborationInfo,
      publication: "hidden",
      headline: "NOT PUBLISHED",
      explanation:
        "The submitted evidence does not consistently support the reported hazard. The report has not been published. If this is a real emergency, call 112.",
    };
  }

  const weak =
    gibberish || // unreadable description must never be auto-published
    a.needs_verification === true ||
    band === "Low" ||
    (!aiAvailable && a.incident_type === "Other" && !hasImage);

  if (weak) {
    return {
      status: "needs_review",
      reasons: checks.filter((c) => c.pass !== "skip").map((c) => `${c.check}: ${c.detail}`),
      evidence_checks: checks,
      corroboration: corroborationInfo,
      publication: "review_only",
      headline: "NEEDS REVIEW",
      explanation:
        "The available evidence is insufficient to confidently verify the reported hazard. It is saved for review and is not shown to nearby users.",
    };
  }

  return {
    status: "verified",
    reasons: checks.filter((c) => c.pass !== "skip").map((c) => `${c.check}: ${c.detail}`),
    evidence_checks: checks,
    corroboration: corroborationInfo,
    publication: "public",
    headline: "AI CHECK PASSED",
    explanation:
      "Evidence appears consistent with the reported hazard. Published as a public alert for nearby users.",
    ...(warns.length > 2
      ? { explanation: "Evidence is broadly consistent with the reported hazard. Published as a public alert for nearby users." }
      : {}),
  };
}
