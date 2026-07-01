import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';

const ID = 'popup_scareware_analyzer';
const VERSION = '0.1.0';

/**
 * Popup / scareware analyzer (plan §6). The heavy lifting (matching system-
 * warning and remote-support language, counting modals, detecting fullscreen
 * lock-in) happens in the content-script extractor; here we score the summary.
 */
export function analyzePopupScareware(ctx: AnalyzerContext): AnalyzerResult | null {
  const { popup } = ctx.features;
  const evidence: string[] = [];
  const categories = new Set<RiskCategory>();
  let score = 0;
  let severity: Severity = 'info';
  const bump = (s: Severity) => {
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  if (popup.systemWarningLanguage) {
    score += 30;
    bump('high');
    categories.add('tech_support_scam');
    categories.add('malicious_popup');
    evidence.push(
      'The page mimics a system or antivirus warning ("your computer is infected", "Windows Defender alert"). Real security warnings never appear inside a web page.',
    );
  }

  if (popup.remoteSupportLanguage) {
    score += 28;
    bump('high');
    categories.add('tech_support_scam');
    categories.add('social_engineering');
    evidence.push(
      'The page urges you to call a support number or install remote-access software (AnyDesk / TeamViewer). This is a hallmark of tech-support scams.',
    );
  }

  // Fake system warning AND a push to call/install remote access together are
  // definitive of a tech-support scam — enough to block outright (plan §6, §7).
  if (popup.systemWarningLanguage && popup.remoteSupportLanguage) {
    score += 20;
    bump('critical');
    evidence.push(
      'The page combines a fake security warning with a demand to call support or install remote-access software — a textbook tech-support scam.',
    );
  }

  if (popup.fullscreenLike && (popup.systemWarningLanguage || popup.remoteSupportLanguage)) {
    score += 12;
    bump('high');
    categories.add('malicious_popup');
    evidence.push('The page tries to lock you into a full-screen alert to create panic.');
  } else if (popup.fullscreenLike && popup.modalCount >= 2) {
    score += 6;
    bump('low');
    evidence.push('The page stacks multiple full-screen overlays.');
  }

  if (score === 0) return null;
  return {
    id: ID,
    version: VERSION,
    score,
    severity,
    categories: [...categories],
    evidence,
  };
}
