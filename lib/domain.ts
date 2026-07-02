/**
 * Domain utilities for the URL/domain analyzer (plan §6).
 *
 * NOTE: proper eTLD+1 resolution needs the Public Suffix List. To keep the
 * skeleton dependency-free we approximate with a small multi-part-TLD table.
 * A production build should swap this for a PSL-backed resolver (bundled data,
 * not remote code — plan §9).
 */

// Multi-label public suffixes we care about most. Extend via signed config later.
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.jp', 'com.au', 'com.br',
  'co.in', 'co.nz', 'com.mx', 'com.sg', 'co.za',
]);

/**
 * Free app-/site-hosting platforms whose per-project subdomain IS the site
 * (i.e. they behave like public suffixes: `victim.vercel.app` is one "site",
 * not a subdomain of a shared `vercel.app`). A bank, retailer, or government
 * login served from one of these is a strong phishing tell — legitimate orgs
 * host their own logins on their own domains.
 */
export const PUBLIC_APP_HOSTS = new Set([
  'vercel.app', 'lovable.app', 'netlify.app', 'netlify.com', 'pages.dev',
  'workers.dev', 'r2.dev', 'web.app', 'firebaseapp.com', 'appspot.com',
  'github.io', 'gitlab.io', 'glitch.me', 'repl.co', 'replit.app', 'surge.sh',
  'fly.dev', 'onrender.com', 'herokuapp.com', 'azurewebsites.net',
  'wixsite.com', 'weebly.com', '000webhostapp.com', 'godaddysites.com',
]);

/**
 * Low-cost / high-abuse TLDs disproportionately used for short-lived scam
 * sites. Weak on their own; meaningful in combination (see url/domain analyzer).
 */
export const SUSPICIOUS_TLDS = new Set([
  'online', 'click', 'site', 'top', 'xyz', 'shop', 'live', 'icu', 'rest',
  'cyou', 'sbs', 'cfd', 'buzz', 'quest', 'monster', 'fit', 'autos', 'bond',
  'lol', 'best', 'store', 'fun', 'life', 'space', 'website', 'digital',
]);

/** Number of labels in the public suffix for a host, e.g. 2 for "co.uk"/"vercel.app". */
function suffixLabelCount(parts: string[]): number {
  if (parts.length >= 3 && PUBLIC_APP_HOSTS.has(parts.slice(-3).join('.'))) return 3;
  const lastTwo = parts.slice(-2).join('.');
  if (PUBLIC_APP_HOSTS.has(lastTwo) || MULTI_PART_TLDS.has(lastTwo)) return 2;
  return 1;
}

/** Best-effort registrable domain (eTLD+1), e.g. "a.b.example.co.uk" -> "example.co.uk". */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  const sfx = suffixLabelCount(parts);
  if (parts.length <= sfx + 1) return host;
  return parts.slice(-(sfx + 1)).join('.');
}

/** The public-suffix app host a URL is served from (e.g. "vercel.app"), else null. */
export function publicAppHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  for (const s of PUBLIC_APP_HOSTS) {
    if (host === s || host.endsWith('.' + s)) return s;
  }
  return null;
}

/** The rightmost TLD label of a host, e.g. "evil.online" -> "online". */
export function tldOf(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.');
  return parts[parts.length - 1] ?? '';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True if a brand name appears as a bounded token anywhere in the host, e.g.
 * "paypal" in "paypal-secure.evil.com" or "amazon-billing.top". Boundaries are
 * non-alphanumerics, so "apple" does NOT match "pineapple.com" and "chase"
 * does NOT match "purchase.com". Short brands require an exact label/token.
 */
export function hostContainsBrandToken(hostname: string, brand: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (brand.length < 4) {
    return host.split(/[^a-z0-9]+/).includes(brand);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(brand)}([^a-z0-9]|$)`).test(host);
}

/** Parse an href into its registrable domain, or null if unparseable/non-web. */
export function hrefToDomain(href: string, base?: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return registrableDomain(u.hostname);
  } catch {
    return null;
  }
}

/** True if any label uses punycode (xn--), a homograph-attack vector (plan §6). */
export function hasPunycode(hostname: string): boolean {
  return hostname.toLowerCase().split('.').some((label) => label.startsWith('xn--'));
}

/** Count of subdomain labels beneath the registrable domain (deep subdomains are a scam signal). */
export function subdomainDepth(hostname: string): number {
  const reg = registrableDomain(hostname);
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === reg) return 0;
  const extra = host.slice(0, host.length - reg.length - 1);
  return extra ? extra.split('.').length : 0;
}

/** Bounded Levenshtein distance (early-exit once we exceed `max`). */
export function levenshtein(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/** The label of a registrable domain without its TLD, e.g. "paypal.com" -> "paypal". */
export function domainLabel(registrable: string): string {
  const parts = registrable.split('.');
  const idx = parts.length - suffixLabelCount(parts) - 1;
  return parts[idx] ?? parts[0] ?? registrable;
}
