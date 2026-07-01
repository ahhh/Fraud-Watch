import type { AnalyzerContext } from './index';
import type { AnalyzerResult } from '@/lib/types';

const ID = 'user_report_analyzer';
const VERSION = '0.1.0';

/**
 * Flags domains the user previously reported as a scam (plan §12). A first-party
 * user report is a strong signal, so this contributes heavily — enough on its
 * own to raise a warning on the next visit — but it stays overridable (the user
 * can un-report / allowlist).
 */
export function analyzeUserReport(ctx: AnalyzerContext): AnalyzerResult | null {
  if (ctx.userReportedAt == null) return null;
  const when = new Date(ctx.userReportedAt).toLocaleDateString();
  return {
    id: ID,
    version: VERSION,
    score: 55,
    severity: 'high',
    categories: ['phishing', 'social_engineering'],
    evidence: [
      `You reported this site as a scam on ${when}. Fraud Watch is flagging it based on your own report.`,
    ],
  };
}
