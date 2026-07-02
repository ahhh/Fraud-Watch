import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';

const ID = 'exfil_beacon_analyzer';
const VERSION = '0.1.0';

/** Field kinds whose presence makes a page's silent data-exfil unambiguously harmful. */
const SENSITIVE_KINDS = new Set([
  'password',
  'otp',
  'card_number',
  'card_cvc',
  'bank_account',
  'seed_phrase',
  'tax_id',
]);

/**
 * Exfil-beacon analyzer (plan §6). Scores the script-derived signals the
 * content-script extractor produced: silent exfiltration to a chat/webhook
 * endpoint, victim-IP fingerprinting, and client-side payment-QR generation.
 *
 * A page that wires a login/PIN form to a Telegram bot is the single most
 * reliable "this is a phishing kit" tell we have — weight it to block.
 */
export function analyzeExfilBeacon(ctx: AnalyzerContext): AnalyzerResult | null {
  const { scripts, forms } = ctx.features;
  const evidence: string[] = [];
  const categories = new Set<RiskCategory>();
  let score = 0;
  let severity: Severity = 'info';
  const bump = (s: Severity) => {
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  const hasSensitiveForm = forms.some(
    (f) =>
      f.passwordFieldCount > 0 ||
      f.intent === 'login' ||
      f.intent === 'payment' ||
      f.intent === 'bank_transfer' ||
      f.intent === 'crypto_seed' ||
      f.fields.some((k) => SENSITIVE_KINDS.has(k)),
  );

  if (scripts.exfilBeacon) {
    // Silent post to a bot/webhook is near-certain kit behaviour on its own.
    score += 45;
    bump('high');
    categories.add('credential_theft');
    categories.add('phishing');
    evidence.push(
      'This page’s own scripts silently send data to a chat bot or webhook (e.g. Telegram/Discord) — a hallmark of a phishing kit built to steal what you type.',
    );
    if (hasSensitiveForm) {
      // Beacon + a form that collects credentials/payment = the loop is closed.
      score += 15;
      bump('critical');
      evidence.push(
        'The page combines that silent exfiltration with a form that collects passwords, codes, or payment details — treat anything you enter as stolen.',
      );
    }
  }

  if (scripts.ipLookup && hasSensitiveForm) {
    // Victim-IP fingerprinting is common on legit sites, so only score it when
    // it accompanies a credential/payment form (classic kit reconnaissance).
    score += 12;
    bump('medium');
    categories.add('phishing');
    evidence.push(
      'The page looks up your IP address / location while asking for sensitive details — common in phishing kits that log each victim.',
    );
  }

  if (scripts.paymentBeacon) {
    score += 12;
    bump('medium');
    categories.add('payment_fraud');
    evidence.push(
      'The page generates a payment QR / instant-payment request in your browser rather than through a known payment processor.',
    );
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
