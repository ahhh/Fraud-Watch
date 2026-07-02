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
  // Netcraft and Microsoft (WDSI) were removed from the UI at the user's
  // request; both are reCAPTCHA-gated and were only ever manual links anyway.
  {
    id: 'google',
    label: 'Google Safe Browsing',
    homepage: 'https://safebrowsing.google.com/safebrowsing/report_phish/',
    enabled: false,
    disabledReason: 'protected by reCAPTCHA',
    manualReportUrl: (url) =>
      `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(url)}`,
    async submit() {
      return skip('google', 'Google Safe Browsing', 'protected by reCAPTCHA');
    },
  },
];

function skip(authority: string, label: string, detail: string, manualUrl?: string): ReporterResult {
  return { authority, label, status: 'skipped', detail, manualUrl };
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
      const manualUrl = r.manualReportUrl?.(reportUrl);
      if (!r.enabled) {
        return {
          authority: r.id,
          label: r.label,
          status: 'skipped',
          detail: r.disabledReason,
          manualUrl,
        } satisfies ReporterResult;
      }
      if (r.originPattern && !(await hasOriginPermission(r.originPattern))) {
        return {
          authority: r.id,
          label: r.label,
          status: 'skipped',
          detail: 'reporting permission not granted',
          manualUrl,
        } satisfies ReporterResult;
      }
      return r.submit(reportUrl);
    }),
  );
}

export type { Reporter, ReporterResult } from './types';
