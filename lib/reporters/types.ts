import type { SubmissionStatus } from '@/lib/reports';

/**
 * External abuse-reporting adapters (plan §12). Each authority is a separate
 * "reporter". Some can be submitted to invisibly in the background (a plain
 * form POST); others are gated by CAPTCHA or require an email, and are marked
 * disabled with a reason rather than attempted.
 */

export interface ReporterResult {
  authority: string; // reporter id
  label: string; // human label for the UI
  status: SubmissionStatus; // submitted | skipped | failed
  detail?: string;
  /**
   * For authorities we can't auto-submit (CAPTCHA/email), the pre-filled report
   * page the user can open to finish the report themselves. reCAPTCHA tokens are
   * origin-bound to the authority's domain and these sites forbid framing, so
   * the captcha can only be solved on their own page — not proxied into our UI.
   */
  manualUrl?: string;
}

export interface Reporter {
  id: string;
  label: string;
  /** The authority's public reporting page (for reference / manual fallback). */
  homepage: string;
  /**
   * Whether we attempt an automatic background submission. Disabled reporters
   * are recorded as "skipped" with `disabledReason` (e.g. CAPTCHA / email).
   */
  enabled: boolean;
  disabledReason?: string;
  /**
   * Host-permission match pattern this reporter needs to POST cross-origin,
   * e.g. "https://www.ncsc.gov.uk/*". Requested at runtime (opt-in, plan §8).
   */
  originPattern?: string;
  /** Perform the submission for `reportUrl`. Only called when `enabled`. */
  submit(reportUrl: string): Promise<ReporterResult>;
  /**
   * For CAPTCHA/email-gated authorities, build the pre-filled report page URL
   * the user can open to finish manually. Used even when `enabled` is false.
   */
  manualReportUrl?(reportUrl: string): string;
}
