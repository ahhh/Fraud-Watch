/**
 * Small seed set of high-value brands for impersonation / typosquat detection
 * (plan §6 brand impersonation analyzer).
 *
 * In production this becomes a signed, remotely-updatable JSON list (plan §9
 * Lane B: signed configs, NOT remote code). For the skeleton we bundle a tiny
 * representative set so the detectors have something concrete to reason about.
 */

export interface Brand {
  /** Brand name as it appears in page text/titles (lowercased for matching). */
  name: string;
  /** Registrable domains the brand legitimately controls (eTLD+1). */
  domains: string[];
  /** Extra keywords that strongly imply the brand (product names, etc.). */
  aliases?: string[];
}

export const BRANDS: Brand[] = [
  { name: 'microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'outlook.com'], aliases: ['office365', 'onedrive'] },
  { name: 'google', domains: ['google.com', 'gmail.com', 'googlemail.com'], aliases: ['gmail'] },
  { name: 'apple', domains: ['apple.com', 'icloud.com'], aliases: ['icloud', 'appleid'] },
  { name: 'amazon', domains: ['amazon.com', 'amazon.co.uk'], aliases: ['aws'] },
  { name: 'paypal', domains: ['paypal.com'] },
  { name: 'coinbase', domains: ['coinbase.com'] },
  { name: 'binance', domains: ['binance.com'] },
  { name: 'metamask', domains: ['metamask.io'] },
  { name: 'chase', domains: ['chase.com'] },
  { name: 'bankofamerica', domains: ['bankofamerica.com'], aliases: ['bank of america'] },
  { name: 'wellsfargo', domains: ['wellsfargo.com'], aliases: ['wells fargo'] },
  { name: 'usps', domains: ['usps.com'] },
  { name: 'fedex', domains: ['fedex.com'] },
  { name: 'dhl', domains: ['dhl.com'] },
  { name: 'netflix', domains: ['netflix.com'] },
  { name: 'facebook', domains: ['facebook.com', 'meta.com'] },
  { name: 'instagram', domains: ['instagram.com'] },
];

/** Fast lookup: registrable domain -> owning brand. */
const DOMAIN_TO_BRAND = new Map<string, Brand>();
for (const brand of BRANDS) {
  for (const d of brand.domains) DOMAIN_TO_BRAND.set(d, brand);
}

export function brandForDomain(domain: string): Brand | undefined {
  return DOMAIN_TO_BRAND.get(domain);
}
