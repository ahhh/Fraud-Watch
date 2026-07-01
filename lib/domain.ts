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

/** Best-effort registrable domain (eTLD+1), e.g. "a.b.example.co.uk" -> "example.co.uk". */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  if (MULTI_PART_TLDS.has(lastTwo)) return parts.slice(-3).join('.');
  // Guard: some three-label hosts under a normal TLD.
  if (MULTI_PART_TLDS.has(lastThree.split('.').slice(-2).join('.'))) return lastThree;
  return lastTwo;
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
  // For multi-part TLDs the label is 3rd-from-last; else 2nd-from-last.
  const idx = parts.length - (MULTI_PART_TLDS.has(parts.slice(-2).join('.')) ? 3 : 2);
  return parts[idx] ?? parts[0] ?? registrable;
}
