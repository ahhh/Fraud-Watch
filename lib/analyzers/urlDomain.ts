import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';
import { BRANDS, brandForDomain } from '@/lib/brands';
import {
  SUSPICIOUS_TLDS,
  domainLabel,
  hasPunycode,
  hostContainsBrandToken,
  levenshtein,
  publicAppHost,
  subdomainDepth,
  tldOf,
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

  // 2. Brand name embedded as a token anywhere in the host, e.g.
  // paypal.com.security-check.evil.net or amazon-billing.top — but not on the
  // brand's own domain. Token-boundary match avoids "apple"⊂"pineapple" FPs.
  const depth = subdomainDepth(hostname);
  const hostLower = hostname.toLowerCase();
  for (const brand of BRANDS) {
    if (isOwnedByBrand?.name === brand.name) continue; // legit brand domain
    if (brand.domains.includes(pageDomain)) continue;
    if (hostContainsBrandToken(hostLower, brand.name)) {
      score += 30;
      bump('high');
      categories.add('brand_impersonation');
      categories.add('phishing');
      evidence.push(
        `The address contains "${brand.name}", but the real domain is "${pageDomain}", which ${brand.name} does not control.`,
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

  // Shared once for the checks below.
  const hasLogin = features.forms.some(
    (f) => f.intent === 'login' || f.passwordFieldCount > 0,
  );
  const hasPayment = features.forms.some(
    (f) =>
      f.intent === 'payment' ||
      f.intent === 'bank_transfer' ||
      f.fields.some((k) =>
        ['card_number', 'card_cvc', 'bank_account'].includes(k),
      ),
  );
  const textBlob = [features.title, ...features.visibleTextSnippets]
    .join(' ')
    .toLowerCase();
  const claimedBrand = isOwnedByBrand
    ? undefined
    : BRANDS.find(
        (b) =>
          textBlob.includes(b.name) ||
          (b.aliases ?? []).some((a) => textBlob.includes(a)),
      );

  // 4. Credential form on a non-brand domain that visibly claims to be a brand.
  if (hasLogin && !isOwnedByBrand && claimedBrand) {
    // Off-brand credential harvesting is a classic, high-signal phishing
    // pattern: the page visibly claims to be a brand and asks for a password,
    // but isn't on that brand's domain. Weight it enough to clear "warn" (§7).
    score += 45;
    bump('high');
    categories.add('credential_theft');
    categories.add('brand_impersonation');
    evidence.push(
      `This page looks like a ${claimedBrand.name} sign-in but is hosted on "${pageDomain}", which is not a ${claimedBrand.name} domain. Do not enter your ${claimedBrand.name} password here.`,
    );
  }

  // 5. Served from a free app-hosting platform. Real banks, retailers, and
  // government agencies never host a login or payment page on vercel.app,
  // lovable.app, github.io, etc. — so pair it with the "moment of harm".
  const appHost = publicAppHost(hostname);
  if (appHost && !isOwnedByBrand) {
    if (hasLogin || hasPayment || claimedBrand) {
      score += 22;
      bump('high');
      categories.add('phishing');
      evidence.push(
        `This page is hosted on ${appHost}, a free app-hosting platform. Legitimate banks, shops, and government sites never collect logins or payments there.`,
      );
    } else {
      score += 5;
      bump('low');
      evidence.push(
        `This page is hosted on ${appHost}, a free app-hosting platform anyone can publish to in minutes.`,
      );
    }
  }

  // 6. Low-cost / high-abuse TLD. Weak alone; add a little more when the page is
  // also collecting credentials or payment, or claims a brand.
  const tld = tldOf(hostname);
  if (SUSPICIOUS_TLDS.has(tld) && !isOwnedByBrand) {
    score += 6;
    bump('low');
    if (hasLogin || hasPayment || claimedBrand) {
      score += 8;
      bump('medium');
    }
    evidence.push(
      `".${tld}" is a low-cost domain extension frequently used for short-lived scam sites.`,
    );
  }

  // 7. Link whose visible text names a brand but points somewhere that isn't
  // that brand (nor this page) — a bait-and-switch anchor. Fire once.
  if (!isOwnedByBrand) {
    outer: for (const link of features.links) {
      if (!link.hrefDomain || link.hrefDomain === pageDomain) continue;
      const anchor = link.visibleText.toLowerCase();
      for (const brand of BRANDS) {
        if (brand.name.length < 5) continue; // avoid short-token FPs in link text
        const names = anchor.includes(brand.name) ||
          (brand.aliases ?? []).some((a) => anchor.includes(a));
        if (names && !brand.domains.includes(link.hrefDomain)) {
          score += 10;
          bump('medium');
          categories.add('brand_impersonation');
          categories.add('phishing');
          evidence.push(
            `A link labelled like ${brand.name} points to "${link.hrefDomain}", which is not an official ${brand.name} address.`,
          );
          break outer;
        }
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
