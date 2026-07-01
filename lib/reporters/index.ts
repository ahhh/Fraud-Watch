import { browser } from 'wxt/browser';
import type { Reporter, ReporterResult } from './types';
import { ncscReporter } from './ncsc';

/**
 * Registry of external abuse-reporting authorities.
 *
 * Only reporters that can be submitted invisibly in the background (no CAPTCHA,
 * no required email) are `enabled`. The rest are kept here — visible and
 * documented — so the UI can tell the user exactly why they were skipped, and
 * so an emailless/captchaless path can be enabled later if one appears.
 */
export const REPORTERS: Reporter[] = [
  ncscReporter, // plain Drupal webform — auto-submits
  {
    // Netcraft's report form (POST /api/report/urls) is gated by reCAPTCHA v3
    // (site key 6LcUG5gaAAAA…, action "report_urls", verified via /captcha/verify).
    // A valid token can only be produced by grecaptcha in a real page, so a
    // background submission can't pass it — kept skipped per the "no captcha" rule.
    id: 'netcraft',
    label: 'Netcraft',
    homepage: 'https://report.netcraft.com/report',
    enabled: false,
    disabledReason: 'protected by reCAPTCHA (v3)',
    async submit() {
      return skip('netcraft', 'Netcraft', 'protected by reCAPTCHA (v3)');
    },
  },
  {
    id: 'microsoft',
    label: 'Microsoft (WDSI)',
    homepage: 'https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site-guest',
    enabled: false,
    disabledReason: 'protected by CAPTCHA',
    async submit() {
      return skip('microsoft', 'Microsoft (WDSI)', 'protected by CAPTCHA');
    },
  },
  {
    id: 'google',
    label: 'Google Safe Browsing',
    homepage: 'https://safebrowsing.google.com/safebrowsing/report_phish/',
    enabled: false,
    disabledReason: 'protected by reCAPTCHA',
    async submit() {
      return skip('google', 'Google Safe Browsing', 'protected by reCAPTCHA');
    },
  },
];

function skip(authority: string, label: string, detail: string): ReporterResult {
  return { authority, label, status: 'skipped', detail };
}

async function hasOriginPermission(pattern: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Submit `reportUrl` to every reporter, in parallel. Enabled reporters that
 * need a host permission we don't hold are skipped (not failed) with a hint.
 */
export async function runReporters(reportUrl: string): Promise<ReporterResult[]> {
  return Promise.all(
    REPORTERS.map(async (r) => {
      if (!r.enabled) {
        return { authority: r.id, label: r.label, status: 'skipped', detail: r.disabledReason };
      }
      if (r.originPattern && !(await hasOriginPermission(r.originPattern))) {
        return {
          authority: r.id,
          label: r.label,
          status: 'skipped',
          detail: 'reporting permission not granted',
        } satisfies ReporterResult;
      }
      return r.submit(reportUrl);
    }),
  );
}

export type { Reporter, ReporterResult } from './types';
