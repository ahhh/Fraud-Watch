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

// Seed set is intentionally focused on US / English-speaking brands and the
// US/UK institutions most targeted by phishing. Region-specific lists (PT/BR/ES
// banks, EU tax authorities, etc.) belong in a signed remote config, not here.
export const BRANDS: Brand[] = [
  // Big tech / accounts
  { name: 'microsoft', domains: ['microsoft.com', 'live.com', 'office.com', 'outlook.com'], aliases: ['office365', 'onedrive'] },
  { name: 'google', domains: ['google.com', 'gmail.com', 'googlemail.com'], aliases: ['gmail'] },
  { name: 'apple', domains: ['apple.com', 'icloud.com'], aliases: ['icloud', 'appleid'] },
  { name: 'amazon', domains: ['amazon.com', 'amazon.co.uk'], aliases: ['aws', 'prime video'] },
  { name: 'adobe', domains: ['adobe.com'] },
  { name: 'dropbox', domains: ['dropbox.com'] },
  { name: 'github', domains: ['github.com'] },
  // Social / comms
  { name: 'facebook', domains: ['facebook.com', 'meta.com'] },
  { name: 'instagram', domains: ['instagram.com'] },
  { name: 'whatsapp', domains: ['whatsapp.com'] },
  { name: 'linkedin', domains: ['linkedin.com'] },
  { name: 'twitter', domains: ['twitter.com', 'x.com'] },
  { name: 'tiktok', domains: ['tiktok.com'] },
  { name: 'snapchat', domains: ['snapchat.com'] },
  // Streaming / entertainment
  { name: 'netflix', domains: ['netflix.com'] },
  { name: 'spotify', domains: ['spotify.com'] },
  { name: 'disney', domains: ['disneyplus.com', 'disney.com'], aliases: ['disney+', 'disney plus'] },
  { name: 'steam', domains: ['steampowered.com', 'steamcommunity.com'] },
  { name: 'roblox', domains: ['roblox.com'] },
  // Payments / fintech
  { name: 'paypal', domains: ['paypal.com'] },
  { name: 'venmo', domains: ['venmo.com'] },
  { name: 'cashapp', domains: ['cash.app'], aliases: ['cash app'] },
  { name: 'zelle', domains: ['zellepay.com'] },
  { name: 'stripe', domains: ['stripe.com'] },
  // Banks / cards
  { name: 'chase', domains: ['chase.com'] },
  { name: 'bankofamerica', domains: ['bankofamerica.com'], aliases: ['bank of america'] },
  { name: 'wellsfargo', domains: ['wellsfargo.com'], aliases: ['wells fargo'] },
  { name: 'citibank', domains: ['citi.com', 'citibank.com'], aliases: ['citi'] },
  { name: 'capitalone', domains: ['capitalone.com'], aliases: ['capital one'] },
  { name: 'americanexpress', domains: ['americanexpress.com'], aliases: ['american express', 'amex'] },
  { name: 'discover', domains: ['discover.com'] },
  { name: 'usbank', domains: ['usbank.com'], aliases: ['u.s. bank'] },
  { name: 'barclays', domains: ['barclays.co.uk', 'barclays.com'] },
  { name: 'hsbc', domains: ['hsbc.com', 'hsbc.co.uk'] },
  { name: 'lloyds', domains: ['lloydsbank.com'], aliases: ['lloyds bank'] },
  // Brokerage / crypto
  { name: 'robinhood', domains: ['robinhood.com'] },
  { name: 'coinbase', domains: ['coinbase.com'] },
  { name: 'binance', domains: ['binance.com'] },
  { name: 'kraken', domains: ['kraken.com'] },
  { name: 'metamask', domains: ['metamask.io'] },
  { name: 'ledger', domains: ['ledger.com'] },
  { name: 'trezor', domains: ['trezor.io'] },
  { name: 'phantom', domains: ['phantom.app'] },
  // Retail / commerce
  { name: 'walmart', domains: ['walmart.com'] },
  { name: 'target', domains: ['target.com'] },
  { name: 'ebay', domains: ['ebay.com'] },
  { name: 'bestbuy', domains: ['bestbuy.com'], aliases: ['best buy'] },
  { name: 'costco', domains: ['costco.com'] },
  // Shipping / postal (heavily phished for "redelivery fee" scams)
  { name: 'usps', domains: ['usps.com'] },
  { name: 'ups', domains: ['ups.com'] },
  { name: 'fedex', domains: ['fedex.com'] },
  { name: 'dhl', domains: ['dhl.com'] },
  { name: 'royalmail', domains: ['royalmail.com'], aliases: ['royal mail'] },
  // US/UK government (impersonated for tax-refund / benefit scams)
  { name: 'irs', domains: ['irs.gov'] },
  { name: 'ssa', domains: ['ssa.gov'], aliases: ['social security administration'] },
  { name: 'hmrc', domains: ['hmrc.gov.uk', 'tax.service.gov.uk'] },
];

/** Fast lookup: registrable domain -> owning brand. */
const DOMAIN_TO_BRAND = new Map<string, Brand>();
for (const brand of BRANDS) {
  for (const d of brand.domains) DOMAIN_TO_BRAND.set(d, brand);
}

export function brandForDomain(domain: string): Brand | undefined {
  return DOMAIN_TO_BRAND.get(domain);
}
