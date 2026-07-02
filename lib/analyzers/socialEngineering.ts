import type { AnalyzerContext } from './index';
import type { AnalyzerResult, RiskCategory, Severity } from '@/lib/types';

const ID = 'social_engineering_analyzer';
const VERSION = '0.1.0';

/**
 * Social-engineering analyzer (plan §6). Deterministic text matching for the
 * two lure families that dominate consumer phishing: the "parcel / customs fee"
 * redelivery scam and the "government / tax refund" impersonation, plus the
 * urgency language kits use to rush the victim past their better judgement.
 *
 * Language patterns are intentionally English-focused (see brands.ts); region-
 * specific lures belong in a signed remote config, not this bundled seed.
 */

// "Your parcel is held — pay a small fee to release it." Redelivery / customs.
const PARCEL_LURE_RE =
  /((parcel|package|shipment|delivery|item)[^.]{0,40}(held|pending|on hold|suspend|unpaid|awaiting|could not be deliver|failed deliver|redeliver|reschedul|customs|clearance|fee))|((customs|import|shipping|handling|clearance)[^.]{0,20}(fee|duty|charge|tax|vat))|(re-?delivery)|((unpaid|outstanding)[^.]{0,20}(toll|fee|balance|charge))/i;

// "This is the IRS / HMRC / Social Security — you owe / you're owed money."
const AUTHORITY_LURE_RE =
  /\b(irs|hmrc|social security|tax (refund|rebate|return|owed)|government (grant|refund|payment)|benefit payment|court (summons|notice|order)|arrest warrant|legal action against)\b/i;

// Pressure / urgency framing designed to short-circuit scrutiny.
const URGENCY_RE =
  /(do not (close|refresh|reload|leave)|expires? (in|within)|within \d+\s*(second|minute|hour|day)|act (now|immediately|fast)|last chance|immediately to avoid|(account|profile|access)[^.]{0,30}(will be|has been)[^.]{0,20}(suspend|clos|lock|terminat|delet|restrict)|\b\d{1,2}\s*hours?\s+(to|remaining|left))/i;

// Field kinds indicating the lure is trying to extract money / credentials now.
const HARM_KINDS = new Set([
  'card_number',
  'card_cvc',
  'bank_account',
  'password',
  'otp',
  'tax_id',
]);

export function analyzeSocialEngineering(ctx: AnalyzerContext): AnalyzerResult | null {
  const { features } = ctx;
  const evidence: string[] = [];
  const categories = new Set<RiskCategory>();
  let score = 0;
  let severity: Severity = 'info';
  const bump = (s: Severity) => {
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    if (order.indexOf(s) > order.indexOf(severity)) severity = s;
  };

  const text = [features.title, ...features.visibleTextSnippets].join(' ');
  const parcel = PARCEL_LURE_RE.test(text);
  const authority = AUTHORITY_LURE_RE.test(text);
  const urgency = URGENCY_RE.test(text);

  const collectsForPayment = features.forms.some(
    (f) =>
      f.intent === 'payment' ||
      f.intent === 'bank_transfer' ||
      f.fields.some((k) => HARM_KINDS.has(k)),
  );

  if (parcel) {
    score += 18;
    bump('medium');
    categories.add('social_engineering');
    categories.add('phishing');
    evidence.push(
      'The page uses a "parcel held / delivery fee" lure — a scam that asks for a small payment to release a package that does not exist.',
    );
  }

  if (authority) {
    score += 18;
    bump('medium');
    categories.add('social_engineering');
    categories.add('phishing');
    evidence.push(
      'The page impersonates a tax or government authority (e.g. a refund or overdue-payment notice) to pressure you into paying or sharing details.',
    );
  }

  if (urgency) {
    score += 8;
    bump('low');
    categories.add('social_engineering');
    evidence.push(
      'The page uses urgency/pressure language ("act now", "expires in…", "do not refresh") to rush you into acting without checking.',
    );
  }

  // A lure that is actively collecting money or credentials is the moment of
  // harm — push it over the warn threshold.
  if ((parcel || authority) && collectsForPayment) {
    score += 14;
    bump('high');
    categories.add('phishing');
    evidence.push(
      'The same page then asks for payment or account details to resolve the fake problem — do not enter them.',
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
