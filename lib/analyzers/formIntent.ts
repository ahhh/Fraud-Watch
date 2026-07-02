import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';
import { brandForDomain } from '@/lib/brands';
import { hrefToDomain } from '@/lib/domain';

const ID = 'form_intent_analyzer';
const VERSION = '0.1.0';

/**
 * Form intent analyzer (plan §6). Elevates risk at the *moment of harm* based
 * on what a form collects and where it posts.
 *
 * The crypto seed / private-key path is near-automatic critical (plan §6):
 * legitimate wallets never ask for a recovery phrase on a web page.
 */
export function analyzeFormIntent(ctx: AnalyzerContext): AnalyzerResult | null {
  const { features, pageDomain } = ctx;
  const evidence: string[] = [];
  const categories = new Set<RiskCategory>();
  let score = 0;
  let severity: Severity = 'info';
  const bump = (s: Severity) => {
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  for (const form of features.forms) {
    const fields = new Set(form.fields);

    // Critical: seed phrase / private key capture. Near-automatic critical
    // (plan §6) — a single seed request alone must clear the block threshold.
    // We intentionally do NOT `continue`: a seed form that also exfiltrates
    // cross-origin (below) is worse, not equivalent.
    if (form.intent === 'crypto_seed' || fields.has('seed_phrase')) {
      score += 85;
      bump('critical');
      categories.add('crypto_wallet_drain');
      evidence.push(
        'This page is asking for a wallet recovery phrase or private key. No legitimate wallet ever needs this on a website — treat it as theft.',
      );
    }

    // Payment / bank fields.
    if (form.intent === 'payment' || fields.has('card_number') || fields.has('card_cvc')) {
      score += 12;
      bump('medium');
      categories.add('payment_fraud');
      evidence.push('This page collects payment card details.');
    }
    if (fields.has('bank_account')) {
      score += 12;
      bump('medium');
      categories.add('payment_fraud');
      evidence.push('This page collects bank account / routing details.');
    }
    if (fields.has('tax_id')) {
      score += 14;
      bump('medium');
      evidence.push('This page collects a tax / national ID number.');
    }

    // Credentials.
    if (form.passwordFieldCount > 0 || fields.has('password')) {
      score += 8;
      bump('low');
      categories.add('credential_theft');
      evidence.push('This page collects a password.');
    }
    if (fields.has('otp')) {
      score += 10;
      bump('medium');
      categories.add('credential_theft');
      evidence.push('This page collects a one-time / 2FA code.');
    }

    // Non-web submission scheme: a form pointing at file:/data:/javascript:
    // almost never happens on a real site. It's the tell of a saved-and-rehosted
    // phishing kit whose <form action> still references the attacker's machine.
    if (
      fields.size > 0 &&
      form.submitScheme &&
      form.submitScheme !== 'http:' &&
      form.submitScheme !== 'https:'
    ) {
      score += 22;
      bump('high');
      categories.add('phishing');
      evidence.push(
        `A form on this page submits to a "${form.submitScheme}" location instead of a normal web address — a sign the page is a copied/rehosted phishing kit.`,
      );
    }

    // Cross-origin submission: form posts somewhere other than the page domain.
    if (form.submitOrigin) {
      const target = hrefToDomain(form.submitOrigin);
      if (target && target !== pageDomain) {
        const targetIsBrand = brandForDomain(target);
        score += targetIsBrand ? 6 : 18;
        bump('high');
        categories.add('credential_theft');
        evidence.push(
          `A form on "${pageDomain}" submits your data to a different domain ("${target}").`,
        );
      }
    }
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
