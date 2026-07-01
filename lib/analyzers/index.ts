import type { AnalyzerResult, PageFeatures } from '@/lib/types';
import { analyzeUrlDomain } from './urlDomain';
import { analyzeFormIntent } from './formIntent';
import { analyzePopupScareware } from './popupScareware';
import { analyzeUserReport } from './userReport';

/**
 * Everything an analyzer needs to run (plan §9 Analyzer SDK). Analyzers are
 * pure functions of this context so they are trivially unit-testable and can
 * run in the service worker off the extracted evidence bundle.
 */
export interface AnalyzerContext {
  features: PageFeatures;
  /** Registrable domain of the page origin, precomputed once. */
  pageDomain: string;
  /** True if the user has allowlisted this domain (analyzers may soften). */
  allowlisted: boolean;
  /** When the user previously reported this domain as a scam, else null. */
  userReportedAt: number | null;
}

export type Analyzer = (ctx: AnalyzerContext) => AnalyzerResult | null;

/** Ordered registry of local detectors. Each is independent and additive. */
export const ANALYZERS: Analyzer[] = [
  analyzeUserReport,
  analyzeUrlDomain,
  analyzeFormIntent,
  analyzePopupScareware,
];

/** Run every analyzer, dropping the ones that had nothing to say (null). */
export function runAnalyzers(ctx: AnalyzerContext): AnalyzerResult[] {
  const out: AnalyzerResult[] = [];
  for (const analyze of ANALYZERS) {
    const result = analyze(ctx);
    if (result && result.score !== 0) out.push(result);
  }
  return out;
}

export { analyzeUrlDomain, analyzeFormIntent, analyzePopupScareware, analyzeUserReport };
