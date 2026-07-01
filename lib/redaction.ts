/**
 * Local redaction layer (plan §1, §5, §10).
 *
 * Runs *before* any feature leaves the content script. The rule is strict:
 * nothing that could be a secret or high-value PII should survive into a
 * PageFeatures bundle. We prefer over-redaction (a false [REDACTED]) to any
 * chance of leaking a credential, OTP, card number, or seed phrase.
 *
 * This is deliberately conservative and pattern-based. It is NOT a substitute
 * for the harder guarantee: we never read password/OTP/card *input values* in
 * the first place (see the extractor in entrypoints/content).
 */

const REDACTED = '[REDACTED]';

interface RedactionRule {
  name: string;
  pattern: RegExp;
}

// Order matters: run more specific patterns before greedier ones.
const RULES: RedactionRule[] = [
  // Crypto seed / recovery phrases: 12+ lowercase words in a row is a strong
  // signal of a BIP-39 mnemonic. We nuke the whole run.
  {
    name: 'seed_phrase',
    pattern: /\b(?:[a-z]{3,8}\s+){11,}[a-z]{3,8}\b/gi,
  },
  // Private keys / long hex blobs (e.g. 0x + 40/64 hex).
  { name: 'hex_key', pattern: /\b(?:0x)?[0-9a-f]{32,}\b/gi },
  // Credit-card-like 13–19 digit runs (allowing spaces/dashes as separators).
  {
    name: 'card_number',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
  },
  // Standalone OTP / 2FA style codes: 4–8 digit isolated groups.
  { name: 'otp_code', pattern: /\b\d{4,8}\b/g },
  // Email addresses.
  {
    name: 'email',
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  // JWT / bearer-token-like long base64url strings.
  { name: 'token', pattern: /\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9._-]{24,}\b/g },
];

/** Redact a single string. Returns text safe to include in a feature bundle. */
export function redactText(input: string): string {
  let out = input;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, REDACTED);
  }
  return out;
}

/**
 * Redact and normalize a visible-text snippet for transport: collapse
 * whitespace, redact, and cap length so we never ship a full page dump.
 */
export function redactSnippet(input: string, maxLen = 240): string {
  const collapsed = input.replace(/\s+/g, ' ').trim();
  const redacted = redactText(collapsed);
  return redacted.length > maxLen ? redacted.slice(0, maxLen) + '…' : redacted;
}

/**
 * Field *names* are safe to keep, but we normalize them to a small vocabulary
 * so we never accidentally forward an autofilled value stored in an attribute.
 */
export function classifyFieldKind(
  name: string,
  type: string,
  autocomplete: string,
): string {
  const hay = `${name} ${type} ${autocomplete}`.toLowerCase();
  if (type === 'password' || /pass(word|wd)?/.test(hay)) return 'password';
  if (/(otp|one[-_ ]?time|2fa|mfa|auth[-_ ]?code|verification)/.test(hay))
    return 'otp';
  if (/(card|cc[-_ ]?num|credit)/.test(hay)) return 'card_number';
  if (/(cvv|cvc|security[-_ ]?code)/.test(hay)) return 'card_cvc';
  if (/(ssn|social[-_ ]?security|tax[-_ ]?id|nino|itin)/.test(hay))
    return 'tax_id';
  if (/(seed|mnemonic|recovery|private[-_ ]?key|passphrase)/.test(hay))
    return 'seed_phrase';
  if (/(iban|routing|account[-_ ]?number|sort[-_ ]?code)/.test(hay))
    return 'bank_account';
  if (type === 'email' || /e-?mail/.test(hay)) return 'email';
  if (type === 'tel' || /phone|mobile|tel/.test(hay)) return 'phone';
  if (/user(name)?|login|account/.test(hay)) return 'username';
  return 'other';
}
