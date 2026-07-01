/**
 * Shared contracts for Fraud Watch.
 *
 * These are the typed boundaries between the three trust zones (plan §3, §10):
 *   - content script  (least trusted: touches hostile page DOM)
 *   - service worker  (orchestrates, scores, owns storage)
 *   - popup UI        (reads verdicts, never touches page DOM)
 *
 * The content script only ever sends *redacted feature summaries* across the
 * boundary — never raw passwords, OTPs, card numbers, cookies, or full page
 * dumps (plan §1, §5, §10).
 */

/** Coarse classification of what a form is trying to collect (plan §6 form intent). */
export type FormIntent =
  | 'login'
  | 'payment'
  | 'bank_transfer'
  | 'tax_identity'
  | 'crypto_seed' // recovery phrase / private key — near-automatic critical
  | 'remote_support'
  | 'oauth_consent'
  | 'generic_contact'
  | 'unknown';

/** Redacted summary of a single form on the page. No field *values* ever cross the boundary. */
export interface FormSummary {
  intent: FormIntent;
  /** Field kinds present, e.g. ["email", "password", "otp"]. Never values. */
  fields: string[];
  /** Origin the form posts to, so we can flag off-brand submission targets. */
  submitOrigin: string | null;
  /** Number of password-type inputs (a strong login/credential signal). */
  passwordFieldCount: number;
}

/** Redacted summary of a link, used for anchor-vs-target mismatch detection (plan §6). */
export interface LinkSummary {
  visibleText: string;
  hrefDomain: string | null;
}

/** Behavioural signals for scareware / fake-support popups (plan §6 popup analyzer). */
export interface PopupSummary {
  modalCount: number;
  fullscreenLike: boolean;
  /** Page text matched fake system/browser-warning language. */
  systemWarningLanguage: boolean;
  /** Page text matched remote-support / "call this number" scam language. */
  remoteSupportLanguage: boolean;
}

/**
 * The redacted evidence a content script extracts from a page. This is the
 * client-side analogue of the plan's RiskEvidenceBundle.page (§5), minus
 * anything the backend would need. All text is already redacted (see redaction.ts).
 */
export interface PageFeatures {
  origin: string;
  /** eTLD+1-ish display domain, e.g. "example.com". */
  displayDomain: string;
  title: string;
  /** Short, redacted, deduped visible-text snippets — not the full page. */
  visibleTextSnippets: string[];
  forms: FormSummary[];
  links: LinkSummary[];
  popup: PopupSummary;
}

/** Severity ladder shared by signals and analyzer results. */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** One deterministic observation contributing to the score (plan §5 deterministic_signals). */
export interface DeterministicSignal {
  signal: string;
  severity: Severity;
  explanation: string;
}

/** Named risk categories (subset of plan §5 output contract, local-relevant ones). */
export type RiskCategory =
  | 'phishing'
  | 'credential_theft'
  | 'payment_fraud'
  | 'tech_support_scam'
  | 'crypto_wallet_drain'
  | 'brand_impersonation'
  | 'malicious_popup'
  | 'social_engineering';

/**
 * What every local analyzer emits (plan §9 analyzer SDK shape). Analyzers are
 * independent and additive — no single giant AI call.
 */
export interface AnalyzerResult {
  /** Stable analyzer id, e.g. "seed_phrase_detector". */
  id: string;
  version: string;
  /** Points this analyzer contributes to the raw risk score (can be negative for trust). */
  score: number;
  severity: Severity;
  categories: RiskCategory[];
  /** Human-readable, user-facing reasons (plan §11: explainable). */
  evidence: string[];
}

/** UX tier the policy engine maps a score onto (plan §7 thresholds). */
export type RecommendedAction =
  | 'allow' // 0–29: no warning
  | 'caution' // 30–49: passive toolbar caution
  | 'warn' // 50–69: inline warning
  | 'step_up_confirm' // 70–84: confirm before sensitive action
  | 'block'; // 85–100: interstitial / block with override

/**
 * The final local verdict for a page. This is what the service worker caches
 * per tab and what the popup + banner render. Named to mirror the plan's
 * RiskVerdict (§5) even though this build computes it locally.
 */
export interface RiskVerdict {
  /** Clamped 0–100 risk score. */
  score: number;
  /** 1–10 site risk rating for the toolbar (plan §14 "risk based rating per site"). */
  rating: number;
  action: RecommendedAction;
  categories: RiskCategory[];
  /** Ordered, deduped, user-facing evidence bullets. */
  evidence: string[];
  /** Short, specific, non-fear-mongering headline (plan §11). */
  userMessage: string;
  /** Per-analyzer breakdown so the UI can show "how it was calculated" (plan §11). */
  breakdown: AnalyzerResult[];
  computedAt: number;
}

// ---------------------------------------------------------------------------
// Messaging contracts (content <-> background). Every message is discriminated
// by `type` and validated on the receiving side (plan §10 messaging security).
// ---------------------------------------------------------------------------

export const MESSAGE_SOURCE = 'fraud-watch' as const;

/** Content script -> background: "I extracted features for this page, score them." */
export interface AnalyzePageMessage {
  source: typeof MESSAGE_SOURCE;
  type: 'analyze_page';
  features: PageFeatures;
}

/** Popup -> background: "Give me the cached verdict for this tab." */
export interface GetVerdictMessage {
  source: typeof MESSAGE_SOURCE;
  type: 'get_verdict';
  tabId?: number;
}

/** Popup -> background: "User allowlisted / removed allowlist for this domain." */
export interface SetAllowlistMessage {
  source: typeof MESSAGE_SOURCE;
  type: 'set_allowlist';
  domain: string;
  allowed: boolean;
}

/** Content/popup -> background: user reported this site as a scam. */
export interface ReportSiteMessage {
  source: typeof MESSAGE_SOURCE;
  type: 'report_site';
  url: string;
  domain: string;
}

export type RequestMessage =
  | AnalyzePageMessage
  | GetVerdictMessage
  | SetAllowlistMessage
  | ReportSiteMessage;

/** Background -> content: the verdict + which UX action to render. */
export interface VerdictResponse {
  source: typeof MESSAGE_SOURCE;
  type: 'verdict';
  verdict: RiskVerdict | null;
  /** Domain-level allowlist state, so the content script can suppress banners. */
  allowlisted: boolean;
}

/** One authority's submission outcome, mirrored to content/popup for display. */
export interface ReportAuthorityResult {
  authority: string;
  label: string;
  status: 'submitted' | 'skipped' | 'failed';
  detail?: string;
}

/** Background -> content/popup: reporting result. */
export interface ReportResultResponse {
  source: typeof MESSAGE_SOURCE;
  type: 'report_result';
  reported: boolean;
  submissions: ReportAuthorityResult[];
}

export type ResponseMessage = VerdictResponse | ReportResultResponse;
