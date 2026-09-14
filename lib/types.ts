export type Severity = "Critical" | "High" | "Moderate" | "Low";

export type IncidentType =
  | "Landslide"
  | "Rockfall"
  | "Flood"
  | "Flash Flood"
  | "Road Blockage"
  | "Building Damage"
  | "Forest Fire"
  | "Avalanche"
  | "Other";

export type IncidentStatus = "Open" | "Responding" | "Resolved";

export type VerificationStatus = "verified" | "needs_review" | "rejected"; // mirrored in lib/verification
export type Publication = "public" | "review_only" | "hidden";

export type ConfidenceBand = "High" | "Medium" | "Low";

/** A retrieved knowledge-base chunk shown to the user as grounding evidence. */
export interface RagSource {
  id: string;
  title: string;
  doc: string;
  excerpt: string;
  score: number;
  organization?: string;
  material?: string; // e.g. "Sample reference material"
}

/**
 * Maps a recommendation to the retrieved passages that support it.
 * `refs` index into the sources array of the same response.
 */
export interface EvidenceLink {
  claim: string;
  refs: number[];
}

/** Stage durations (ms) captured server-side — presentation trace only. */
export interface PipelineTimings {
  classificationMs?: number;
  retrievalMs?: number;
  groundingMs?: number;
  totalMs: number;
}

/** Structured JSON the AI pipeline must produce for every report. */
export interface IncidentAnalysis {
  incident_type: IncidentType;
  severity: Severity;
  confidence: number; // 0..1 raw model score (shown as a band in the UI)
  summary: string;
  risk_factors: string[];
  immediate_actions: string[];
  avoid: string[];
  recommended_response: string;
  requires_urgent_attention: boolean;
  severity_reasons?: string[]; // concrete evidence behind the severity call
  needs_verification?: boolean; // weak/contradictory evidence — human check advised
  verification_note?: string;
}

export interface AnalyzeResponse {
  analysis: IncidentAnalysis;
  sources: RagSource[];
  evidence: EvidenceLink[];
  aiAvailable: boolean;
  grounded: boolean;
  query_used: string;
  timings: PipelineTimings;
  verification: import("./verification").VerificationResult;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
  aiAvailable: boolean;
}

export interface Incident {
  id: string;
  created_at: string; // ISO
  location: string;
  lat: number;
  lng: number;
  coords_approximate?: boolean; // true when coordinates are not exact
  incident_type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  description: string;
  summary: string;
  confidence: number;
  risk_factors: string[];
  immediate_actions: string[];
  avoid: string[];
  recommended_response: string;
  requires_urgent_attention: boolean;
  severity_reasons?: string[];
  needs_verification?: boolean;
  verification_note?: string;
  origin: "seed" | "ai" | "manual";
  reporter_id?: string; // auth user id — never exposed publicly
  reporter_details?: {
    hazard_type?: string;
    when?: string;
    when_exact?: string;
    happening_now?: string;
    affected?: string[];
    casualties?: string;
    observed_severity?: string;
    observations?: string;
  };
  sources: { title: string; doc?: string }[];
  evidence?: EvidenceLink[];
  pipeline?: PipelineTimings & { saved_at?: string };
  status_history?: { status: IncidentStatus; at: string }[];

  /* --- community verification layer --- */
  verification?: VerificationStatus;
  verification_reasons?: string[];
  publication?: Publication; // public | review_only | hidden
  reporter_label?: string; // "Community report" — never a real identity
  last_confirmed_at?: string; // community "still present" confirmations
  confirmations_yes?: number;
  confirmations_no?: number;
  related_ids?: string[]; // associated reports describing the same event
}

export interface IncidentFilters {
  severity?: string;
  type?: string;
  status?: string;
  location?: string;
  q?: string;
}
