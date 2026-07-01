/**
 * Types for the optional AI-generated-text ("slop") detector.
 *
 * Two independent sources of a verdict, sharing one normalized shape:
 *   - LOCAL heuristic  — always available, sends nothing off-device.
 *   - REMOTE sloptotal — opt-in; posts scanned text to a user-configured
 *     self-hosted sloptotal endpoint (https://github.com/pablocaeg/sloptotal).
 *
 * We intentionally do NOT host sloptotal; the user points us at their own
 * endpoint. If no endpoint is configured (or the feature is off), only the
 * local heuristic runs.
 */

/** Unified verdict, matching sloptotal's clean/mixed/ai buckets. */
export type SlopVerdict = 'clean' | 'mixed' | 'ai';

/** sloptotal's traffic-light indicator, kept for fidelity with its API. */
export type SlopIndicator = 'green' | 'yellow' | 'red';

/** Where a segment's verdict came from. */
export type SlopSource = 'local' | 'remote';

/**
 * Score → verdict thresholds, identical to sloptotal's `_compute_fakespot_score`
 * / `_quick_analyze_text_inner` so local and remote read the same on screen:
 *   score >= 65 → ai (red) · 35 < score < 65 → mixed (yellow) · <= 35 → clean (green)
 */
export function verdictForScore(score: number): SlopVerdict {
  if (score >= 65) return 'ai';
  if (score > 35) return 'mixed';
  return 'clean';
}

export function indicatorForVerdict(v: SlopVerdict): SlopIndicator {
  return v === 'ai' ? 'red' : v === 'mixed' ? 'yellow' : 'green';
}

/** sloptotal returns green/yellow/red; map back to our verdict vocabulary. */
export function verdictForIndicator(indicator: string): SlopVerdict {
  return indicator === 'red' ? 'ai' : indicator === 'yellow' ? 'mixed' : 'clean';
}

/** One scored block of text, addressable by id so we can map it back to a DOM node. */
export interface SlopSegment {
  id: string;
  /** Redaction-safe: this is on-page visible prose, truncated for transport. */
  textPreview: string;
  charCount: number;
  score: number; // 0–100
  verdict: SlopVerdict;
  confidence: string; // "none" | "low" | "medium" | "high"
  source: SlopSource;
  /** Human-readable heuristic hits (local only); empty for remote. */
  reasons: string[];
}

/** Aggregate result for a scan of a page (or selection). */
export interface SlopReport {
  segments: SlopSegment[];
  overallScore: number;
  overallVerdict: SlopVerdict;
  aiCount: number;
  total: number;
  source: SlopSource;
  /** Present when a remote scan ran; the endpoint origin (for user disclosure). */
  endpointHost?: string;
  elapsedMs?: number;
  /** Non-fatal note, e.g. "remote unavailable, showing local heuristic". */
  note?: string;
}

/** Persisted user settings for the feature (plan §8 opt-in posture). */
export interface SlopSettings {
  /** Master switch for the local heuristic + UI. Default on (nothing leaves device). */
  enabled: boolean;
  /** Opt-in to send scanned text to the remote sloptotal endpoint. Default off. */
  useRemote: boolean;
  /** Base URL of a self-hosted sloptotal server, e.g. http://localhost:8000. */
  endpoint: string;
  /** Minimum characters for a block to be worth scoring. */
  minChars: number;
}

export const DEFAULT_SLOP_SETTINGS: SlopSettings = {
  enabled: true,
  useRemote: false,
  endpoint: '',
  minChars: 180,
};

// --- sloptotal raw API response shapes (only the fields we read) -----------

/** POST /api/scan/snippets → { results: [...], total, timing } */
export interface SnippetScanResult {
  id: string;
  score: number;
  indicator: string; // green | yellow | red
  confidence: string;
  chars: number;
}
export interface SnippetScanResponse {
  results: SnippetScanResult[];
  total: number;
  timing?: { total_ms?: number };
}

/** POST /api/quick-score → { score, verdict, confidence, ... } */
export interface QuickScoreResponse {
  score: number;
  verdict: string; // clean | mixed | ai
  confidence: string;
  elapsed_ms?: number;
}
