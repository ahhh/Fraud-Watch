import type {
  FormIntent,
  FormSummary,
  LinkSummary,
  PageFeatures,
  PopupSummary,
  ScriptSignals,
} from '@/lib/types';
import { classifyFieldKind, redactSnippet } from '@/lib/redaction';
import { hrefToDomain, registrableDomain } from '@/lib/domain';

/**
 * Page feature extractor (plan §4 Stage 1). Runs in the content script and
 * produces a *redacted* PageFeatures bundle.
 *
 * Hard privacy rule (plan §1, §10): we never read the `.value` of password,
 * OTP, card, or seed inputs. We classify fields by name/type/autocomplete only.
 */

const MAX_SNIPPETS = 12;
const MAX_FORMS = 15;
const MAX_LINKS = 40;

// Language cues for the popup/scareware analyzer (plan §6). Kept here because
// they operate on live page text; the analyzer just scores the boolean result.
const SYSTEM_WARNING_RE =
  /(your (computer|pc|system) (is|has been) (infected|locked|blocked)|virus detected|windows defender (alert|warning)|security alert|call (microsoft|apple) support|do not (close|restart) (your|this)|trojan|spyware detected|your browser (is|has been) (locked|compromised))/i;
const REMOTE_SUPPORT_RE =
  /(anydesk|teamviewer|ultraviewer|remote (desktop|access|support)|call (this|the) (number|toll[- ]?free)|dial \+?\d|microsoft technician|apple technician|refund (department|overpayment))/i;

// Script/resource-URL cues for the exfil-beacon analyzer (plan §6). Matched
// against inline <script> text and in-DOM resource URLs, never their content.
// A hostile page that ships a Telegram/Discord webhook or bot token is a
// near-certain phishing kit; victim-IP lookups and client-side payment-QR
// generation are strong supporting tells.
const EXFIL_BEACON_RE =
  /(api\.telegram\.org|t\.me\/|\bbot\d{5,}:[A-Za-z0-9_-]{20,}\b|discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/services)/i;
const IP_LOOKUP_RE =
  /(api\.ipify\.org|ipapi\.co|ip-api\.com|ipwho\.is|ipinfo\.io|geojs\.io|bigdatacloud\.net|ipgeolocation\.io|db-ip\.com)/i;
const PAYMENT_BEACON_RE =
  /(api\.qrserver\.com|chart\.googleapis\.com\/chart\?cht=qr|pix[_-]?code|pix[_-]?payload|copia e cola|\bmb ?way\b)/i;

function fieldKinds(form: HTMLFormElement): { kinds: string[]; passwordCount: number } {
  const kinds = new Set<string>();
  let passwordCount = 0;
  const inputs = form.querySelectorAll('input, textarea, select');
  for (const el of Array.from(inputs)) {
    const input = el as HTMLInputElement;
    const type = (input.type || el.tagName).toLowerCase();
    if (type === 'hidden') continue; // never surface hidden field metadata (plan §5)
    const kind = classifyFieldKind(
      input.name || input.id || '',
      type,
      input.autocomplete || '',
    );
    kinds.add(kind);
    if (kind === 'password') passwordCount++;
  }
  return { kinds: [...kinds], passwordCount };
}

/** Heuristic form-intent classification (plan §6). Deterministic, name-based. */
function classifyFormIntent(
  kinds: string[],
  formText: string,
): FormIntent {
  const k = new Set(kinds);
  const text = formText.toLowerCase();
  if (k.has('seed_phrase') || /recovery phrase|seed phrase|mnemonic|private key/.test(text))
    return 'crypto_seed';
  if (k.has('card_number') || k.has('card_cvc')) return 'payment';
  if (k.has('bank_account')) return 'bank_transfer';
  if (k.has('tax_id')) return 'tax_identity';
  if (/remote (support|desktop)|anydesk|teamviewer/.test(text)) return 'remote_support';
  if (/(authorize|grant|allow) .*(access|permission)|oauth|scope/.test(text) && k.has('username'))
    return 'oauth_consent';
  if (k.has('password') || k.has('otp')) return 'login';
  if (k.size > 0) return 'generic_contact';
  return 'unknown';
}

function extractForms(): FormSummary[] {
  const forms = Array.from(document.forms).slice(0, MAX_FORMS);
  return forms.map((form) => {
    const { kinds, passwordCount } = fieldKinds(form);
    // Only labels/placeholders/legends for intent text — never input values.
    const labelText = Array.from(
      form.querySelectorAll('label, legend, [placeholder]'),
    )
      .map((el) => (el as HTMLElement).getAttribute('placeholder') || el.textContent || '')
      .join(' ')
      .slice(0, 400);
    const action = form.getAttribute('action') || '';
    let submitOrigin: string | null = null;
    let submitScheme: string | null = null;
    try {
      const resolved = new URL(action, location.href);
      submitOrigin = resolved.origin;
      submitScheme = resolved.protocol;
    } catch {
      submitOrigin = null;
      submitScheme = null;
    }
    return {
      intent: classifyFormIntent(kinds, labelText),
      fields: kinds,
      submitOrigin,
      submitScheme,
      passwordFieldCount: passwordCount,
    };
  });
}

function extractLinks(): LinkSummary[] {
  const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 200);
  const seen = new Set<string>();
  const out: LinkSummary[] = [];
  for (const a of anchors) {
    const anchor = a as HTMLAnchorElement;
    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) continue;
    const domain = hrefToDomain(anchor.href, location.href);
    if (!domain) continue;
    const key = `${text}|${domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ visibleText: redactSnippet(text, 80), hrefDomain: domain });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

function extractPopupSignals(bodyText: string): PopupSummary {
  // Count overlay-like elements: fixed/absolute, high z-index, covering viewport.
  let modalCount = 0;
  let fullscreenLike = false;
  const candidates = document.querySelectorAll(
    '[role="dialog"], [role="alertdialog"], .modal, .popup, .overlay, dialog[open]',
  );
  for (const el of Array.from(candidates).slice(0, 50)) {
    const style = getComputedStyle(el as Element);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const pos = style.position;
    if (pos === 'fixed' || pos === 'absolute' || (el as HTMLElement).tagName === 'DIALOG') {
      modalCount++;
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (
        rect.width >= window.innerWidth * 0.9 &&
        rect.height >= window.innerHeight * 0.8
      ) {
        fullscreenLike = true;
      }
    }
  }
  return {
    modalCount,
    fullscreenLike,
    systemWarningLanguage: SYSTEM_WARNING_RE.test(bodyText),
    remoteSupportLanguage: REMOTE_SUPPORT_RE.test(bodyText),
  };
}

function extractVisibleSnippets(): string[] {
  // Prefer headings and prominent text; fall back to body. Redact + cap.
  const nodes = Array.from(
    document.querySelectorAll('h1, h2, h3, [role="heading"], p, li, button, a'),
  ).slice(0, 300);
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const raw = (n as HTMLElement).innerText || n.textContent || '';
    const s = redactSnippet(raw, 200);
    if (s.length < 8 || seen.has(s)) continue;
    seen.add(s);
    snippets.push(s);
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return snippets;
}

/**
 * Scan the page's own scripts + in-DOM resource URLs for phishing-kit tells.
 * We only ever emit booleans — the scanned text (which may contain page
 * secrets on a hostile page) never leaves the content script (plan §1, §10).
 */
function extractScriptSignals(): ScriptSignals {
  const parts: string[] = [];
  // Inline script bodies (where kits typically hardcode bot tokens / IP calls).
  for (const s of Array.from(document.scripts).slice(0, 60)) {
    if (!s.src && s.textContent) parts.push(s.textContent);
  }
  // Resource-bearing attributes already in the DOM (script/img src, form action).
  for (const el of Array.from(
    document.querySelectorAll('[src], [href], [action], [data-src]'),
  ).slice(0, 400)) {
    const e = el as HTMLElement;
    parts.push(
      `${e.getAttribute('src') || ''} ${e.getAttribute('href') || ''} ${
        e.getAttribute('action') || ''
      } ${e.getAttribute('data-src') || ''}`,
    );
  }
  const hay = parts.join(' ').slice(0, 200000);
  return {
    exfilBeacon: EXFIL_BEACON_RE.test(hay),
    ipLookup: IP_LOOKUP_RE.test(hay),
    paymentBeacon: PAYMENT_BEACON_RE.test(hay),
  };
}

/** Build the full redacted PageFeatures bundle for the current document. */
export function extractPageFeatures(): PageFeatures {
  const bodyText = (document.body?.innerText || '').slice(0, 20000);
  return {
    origin: location.origin,
    displayDomain: registrableDomain(location.hostname),
    title: redactSnippet(document.title || '', 120),
    visibleTextSnippets: extractVisibleSnippets(),
    forms: extractForms(),
    links: extractLinks(),
    popup: extractPopupSignals(bodyText),
    scripts: extractScriptSignals(),
  };
}
