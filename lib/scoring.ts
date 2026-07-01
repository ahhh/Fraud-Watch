import type {
  AnalyzerResult,
  RecommendedAction,
  RiskCategory,
  RiskVerdict,
} from '@/lib/types';

/**
 * Risk scoring + policy engine (plan §7).
 *
 * Weighted, additive, and explainable — not a black-box binary classifier.
 * Analyzer scores sum into a raw score, trust signals subtract, and the total
 * is clamped to 0–100 and mapped onto a UX tier. Every warning must remain
 * overridable (plan §7: "never make the product impossible to override").
 */

/** Thresholds from plan §7. Lower bound of each tier. */
const THRESHOLDS: Array<{ min: number; action: RecommendedAction }> = [
  { min: 85, action: 'block' },
  { min: 70, action: 'step_up_confirm' },
  { min: 50, action: 'warn' },
  { min: 30, action: 'caution' },
  { min: 0, action: 'allow' },
];

export function actionForScore(score: number): RecommendedAction {
  for (const tier of THRESHOLDS) {
    if (score >= tier.min) return tier.action;
  }
  return 'allow';
}

/** Map a 0–100 score to the 1–10 per-site rating shown on the toolbar (plan §14). */
export function scoreToRating(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score / 10) || 1));
}

export interface ScoreInputs {
  results: AnalyzerResult[];
  /** Trust reduction, e.g. page is on a known brand's own domain (plan §7). */
  trustedDomain: boolean;
  /** User has explicitly allowlisted this domain (plan §7, §8). */
  allowlisted: boolean;
}

/** Build a short, specific, non-fear-mongering headline (plan §11). */
function headline(action: RecommendedAction, categories: RiskCategory[]): string {
  if (action === 'allow') return 'No fraud signals detected on this page.';
  const cat = categories[0];
  const byCat: Partial<Record<RiskCategory, string>> = {
    crypto_wallet_drain: 'Stop — this page is trying to steal your crypto wallet.',
    tech_support_scam: 'This looks like a fake tech-support / virus scam.',
    credential_theft: 'This page may be trying to steal your login.',
    brand_impersonation: 'This page impersonates a brand it does not belong to.',
    phishing: 'This page shows signs of phishing.',
    payment_fraud: 'Be careful entering payment details on this page.',
    malicious_popup: 'This page uses deceptive pop-up tactics.',
    social_engineering: 'This page is using pressure tactics to manipulate you.',
  };
  if (cat && byCat[cat]) return byCat[cat]!;
  return action === 'block'
    ? 'This page looks dangerous.'
    : 'This page looks suspicious — proceed carefully.';
}

/** De-dupe while preserving first-seen order. */
function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function computeVerdict(inputs: ScoreInputs): RiskVerdict {
  const { results, trustedDomain, allowlisted } = inputs;

  let raw = results.reduce((sum, r) => sum + r.score, 0);
  if (trustedDomain) raw -= 40; // strong trust signal (plan §7 trusted_domain_score)
  if (allowlisted) raw -= 60; // user override (plan §7 user_allowlist_score)

  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const action = actionForScore(score);
  // On an "allow" verdict, don't surface scary category chips / evidence for
  // signals that were fully offset by trust — a safe page reads as safe (§11).
  const categories = action === 'allow' ? [] : dedupe(results.flatMap((r) => r.categories));
  // Order evidence by contributing analyzer score, strongest first (plan §11).
  const evidence =
    action === 'allow'
      ? []
      : dedupe([...results].sort((a, b) => b.score - a.score).flatMap((r) => r.evidence));

  return {
    score,
    rating: scoreToRating(score),
    action,
    categories,
    evidence,
    userMessage: headline(action, categories),
    breakdown: results,
    computedAt: Date.now(),
  };
}
