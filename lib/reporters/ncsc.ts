import { browser } from 'wxt/browser';
import type { Reporter, ReporterResult } from './types';

/**
 * NCSC "report a scam website" adapter.
 *
 * The NCSC page is a plain Drupal webform (no CAPTCHA, no email required), so
 * we can submit it in the background: GET the form to obtain the anti-tamper
 * `form_build_id` + `form_id`, then POST the form-encoded fields. Extensions
 * with host permission for the origin are not subject to CORS, so the POST
 * lands server-side even though we can't read a cross-origin response body.
 *
 * Field contract (verified against the live form):
 *   enter_the_website_link_or_url   (required)  — the reported URL
 *   how_did_you_receive_it_required (required)  — one of a fixed option set
 *   tell_us_more_optional           (optional)
 *   form_build_id, form_id          (hidden, scraped from the GET)
 *   op = "Submit"
 */

export const NCSC_FORM_URL =
  'https://www.ncsc.gov.uk/section/about-this-website/report-scam-website';
export const NCSC_ORIGIN_PATTERN = 'https://www.ncsc.gov.uk/*';

/** A browser-extension is the "while browsing web" acquisition channel. */
const HOW_RECEIVED = 'While browsing web';

export interface NcscFormTokens {
  formBuildId: string;
  formId: string;
}

/** Extract the hidden Drupal tokens from the fetched form HTML. Pure + testable. */
export function parseNcscTokens(html: string): NcscFormTokens | null {
  const build = html.match(/name="form_build_id"[^>]*value="([^"]+)"/);
  const id = html.match(/name="form_id"[^>]*value="([^"]+)"/);
  if (!build?.[1] || !id?.[1]) return null;
  return { formBuildId: build[1], formId: id[1] };
}

/** Build the x-www-form-urlencoded body for a submission. Pure + testable. */
export function buildNcscBody(reportUrl: string, tokens: NcscFormTokens): string {
  const params = new URLSearchParams();
  params.set('enter_the_website_link_or_url', reportUrl);
  params.set('how_did_you_receive_it_required', HOW_RECEIVED);
  params.set('tell_us_more_optional', '');
  params.set('form_build_id', tokens.formBuildId);
  params.set('form_id', tokens.formId);
  params.set('op', 'Submit');
  return params.toString();
}

/**
 * Fixed id for our session DNR rule. NCSC 403s any POST whose `Origin` header
 * isn't same-origin; a service-worker fetch always sends `chrome-extension://…`,
 * so we strip the header for this exact endpoint (verified: no-Origin → 200).
 */
const ORIGIN_STRIP_RULE_ID = 4801;

async function ensureOriginStripRule(): Promise<void> {
  const dnr = browser.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return;
  try {
    await dnr.updateSessionRules({
      removeRuleIds: [ORIGIN_STRIP_RULE_ID],
      addRules: [
        {
          id: ORIGIN_STRIP_RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'origin', operation: 'remove' }],
          },
          condition: {
            urlFilter: '|https://www.ncsc.gov.uk/section/about-this-website/report-scam-website',
            requestMethods: ['post'],
            resourceTypes: ['xmlhttprequest', 'other'],
          },
        },
      ],
    } as Parameters<typeof dnr.updateSessionRules>[0]);
  } catch {
    /* best effort — if DNR is unavailable the POST will 403 and be reported failed */
  }
}

async function submit(reportUrl: string): Promise<ReporterResult> {
  const base = { authority: 'ncsc', label: 'NCSC (UK)' } as const;
  try {
    // 0. Strip the cross-origin `Origin` header so NCSC doesn't 403 the POST.
    await ensureOriginStripRule();

    // 1. Fetch the form to obtain fresh anti-tamper tokens + any cookies.
    const page = await fetch(NCSC_FORM_URL, { credentials: 'include' });
    if (!page.ok) {
      return { ...base, status: 'failed', detail: `form GET ${page.status}` };
    }
    const tokens = parseNcscTokens(await page.text());
    if (!tokens) {
      return { ...base, status: 'failed', detail: 'form fields not found (form changed?)' };
    }

    // 2. POST the completed form.
    const res = await fetch(NCSC_FORM_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildNcscBody(reportUrl, tokens),
    });
    if (res.ok || res.status === 303 || res.status === 302) {
      return { ...base, status: 'submitted', detail: 'Report sent to NCSC.' };
    }
    return { ...base, status: 'failed', detail: `submit ${res.status}` };
  } catch (err) {
    return { ...base, status: 'failed', detail: err instanceof Error ? err.message : 'network error' };
  }
}

export const ncscReporter: Reporter = {
  id: 'ncsc',
  label: 'NCSC (UK)',
  homepage: NCSC_FORM_URL,
  enabled: true,
  originPattern: NCSC_ORIGIN_PATTERN,
  submit,
};
