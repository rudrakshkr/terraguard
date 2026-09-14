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

/** Structured JSON the AI pipeline must produce for every report. */
export interface IncidentAnalysis {
  incident_type: IncidentType;
  severity: Severity;
  confidence: number; // 0..1
  summary: string;
  risk_factors: string[];
  immediate_actions: string[];
  avoid: string[];
  recommended_response: string;
  requires_urgent_attention: boolean;
}

/** A retrieved knowledge-base chunk shown to the user as grounding evidence. */
export interface RagSource {
  id: string;
  title: string;
  doc: string;
  excerpt: string;
  score: number;
}

export interface AnalyzeResponse {
  analysis: IncidentAnalysis;
  sources: RagSource[];
  aiAvailable: boolean;
  grounded: boolean; // true when recommendations were conditioned on retrieved sources
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
  origin: "seed" | "ai" | "manual";
  sources: { title: string; doc?: string }[];
}

export interface IncidentFilters {
  severity?: string;
  type?: string;
  status?: string;
  location?: string;
  q?: string;
}
