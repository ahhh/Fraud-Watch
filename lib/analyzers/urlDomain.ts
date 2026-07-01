import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';
import { BRANDS, brandForDomain } from '@/lib/brands';
import {
  domainLabel,
  hasPunycode,
  levenshtein,
  subdomainDepth,
} from '@/lib/domain';

const ID = 'url_domain_analyzer';
const VERSION = '0.1.0';

/**
 * URL / domain analyzer (plan §6).
 *
 * Deterministic, no network: punycode/homograph tricks, lookalike/typosquat
 * against known brands, misleading deep subdomains that embed a brand name,
 * and credential/login forms served from a domain that isn't the brand's.
 */
export function analyzeUrlDomain(ctx: AnalyzerContext): AnalyzerResult | null {
  const { features, pageDomain } = ctx;
  const evidence: string[] = [];
  const categories = new Set<RiskCategory>();
  let score = 0;
  let severity: Severity = 'info';
  const bump = (s: Severity) => {
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  const origin = features.origin;
  let hostname = '';
  try {
    hostname = new URL(origin).hostname;
  } catch {
    /* non-URL origin (e.g. about:) — nothing to analyze */
    return null;
  }

  // The page's own registrable domain is trusted-until-proven; brand match on
  // the page domain itself is a *trust* signal handled in scoring, not here.
  const isOwnedByBrand = brandForDomain(pageDomain);

  // 1. Punycode / homograph.
  if (hasPunycode(hostname)) {
    score += 25;
    bump('high');
    categories.add('phishing');
    evidence.push(
      'The address uses punycode (xn--), which can disguise a lookalike domain using non-Latin characters.',
    );
  }

  // 2. Deep, brand-embedding subdomains, e.g. paypal.com.security-check.evil.net
  const depth = subdomainDepth(hostname);
  const hostLower = hostname.toLowerCase();
  for (const brand of BRANDS) {
    if (isOwnedByBrand?.name === brand.name) continue; // legit brand domain
    const brandInSub =
      hostLower.includes(`${brand.name}.`) || hostLower.includes(`.${brand.name}`);
    if (brandInSub && !brand.domains.includes(pageDomain)) {
      score += 30;
      bump('high');
      categories.add('brand_impersonation');
      categories.add('phishing');
      evidence.push(
        `The address contains "${brand.name}" in a subdomain, but the real domain is "${pageDomain}", which ${brand.name} does not control.`,
      );
      break;
    }
  }
  if (depth >= 3) {
    score += 8;
    bump('low');
    evidence.push(
      `The address has an unusually deep subdomain chain (${depth} levels), a common obfuscation tactic.`,
    );
  }

  // 3. Typosquat: page-domain label within small edit distance of a brand label.
  if (!isOwnedByBrand) {
    const pageLabel = domainLabel(pageDomain);
    for (const brand of BRANDS) {
      for (const legit of brand.domains) {
        const legitLabel = domainLabel(legit);
        if (pageLabel === legitLabel) continue;
        const dist = levenshtein(pageLabel, legitLabel, 3);
        if (dist >= 1 && dist <= 2 && Math.abs(pageLabel.length - legitLabel.length) <= 2) {
          score += 28;
          bump('high');
          categories.add('brand_impersonation');
          categories.add('phishing');
          evidence.push(
            `The domain "${pageDomain}" is a near-lookalike of "${legit}" (${brand.name}) — likely typosquatting.`,
          );
          break;
        }
      }
    }
  }

  // 4. Credential form on a non-brand domain that visibly claims to be a brand.
  const hasLogin = features.forms.some(
    (f) => f.intent === 'login' || f.passwordFieldCount > 0,
  );
  if (hasLogin && !isOwnedByBrand) {
    const textBlob = [features.title, ...features.visibleTextSnippets]
      .join(' ')
      .toLowerCase();
    for (const brand of BRANDS) {
      const claimsBrand =
        textBlob.includes(brand.name) ||
        (brand.aliases ?? []).some((a) => textBlob.includes(a));
      if (claimsBrand) {
        // Off-brand credential harvesting is a classic, high-signal phishing
        // pattern: the page visibly claims to be a brand and asks for a
        // password, but isn't on that brand's domain. Weight it enough to
        // clear the "warn" threshold on its own (plan §7).
        score += 45;
        bump('high');
        categories.add('credential_theft');
        categories.add('brand_impersonation');
        evidence.push(
          `This page looks like a ${brand.name} sign-in but is hosted on "${pageDomain}", which is not a ${brand.name} domain. Do not enter your ${brand.name} password here.`,
        );
        break;
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
