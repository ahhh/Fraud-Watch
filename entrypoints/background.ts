import { defineBackground } from 'wxt/utils/define-background';
import { browser, type Browser } from 'wxt/browser';
import {
  MESSAGE_SOURCE,
  type ReportResultResponse,
  type RiskVerdict,
  type VerdictResponse,
} from '@/lib/types';
import { parseRequest } from '@/lib/validate';
import { getReportedSite, saveReport } from '@/lib/reports';
import { runReporters } from '@/lib/reporters';
import { runAnalyzers } from '@/lib/analyzers';
import { computeVerdict } from '@/lib/scoring';
import { brandForDomain } from '@/lib/brands';
import { registrableDomain } from '@/lib/domain';
import {
  cacheVerdict,
  clearVerdict,
  getCachedVerdict,
  isAllowlisted,
  setAllowlisted,
} from '@/lib/storage';
import { getSlopSettings, remoteReady } from '@/lib/slop/settings';
import { checkHealth, endpointOrigin, scanSnippets } from '@/lib/slop/sloptotal';
import {
  isSlopMessage,
  type SlopBackgroundRequest,
  type SlopHealthResponse,
  type SlopRemoteScanResponse,
} from '@/lib/slop/messages';

/**
 * Service worker: event router + orchestration (plan §3, §4). Makes the fast
 * local decision. It validates untrusted content-script messages, runs the
 * deterministic analyzers, scores, caches the verdict per tab, and reflects
 * state on the toolbar. Backend escalation (plan §4 Stage 3) plugs in here.
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // Returning true keeps the message channel open for the async response.
    if (isSlopMessage(raw)) {
      void handleSlopMessage(raw).then(sendResponse);
      return true;
    }
    void handleMessage(raw, sender).then(sendResponse);
    return true;
  });

  // Clean up per-tab verdict cache and reset badge when tabs go away/navigate.
  browser.tabs.onRemoved.addListener((tabId) => void clearVerdict(tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
      void clearVerdict(tabId);
      void setBadge(tabId, null);
    }
  });
});

async function handleMessage(
  raw: unknown,
  sender: Browser.runtime.MessageSender,
): Promise<VerdictResponse | ReportResultResponse> {
  const empty: VerdictResponse = {
    source: MESSAGE_SOURCE,
    type: 'verdict',
    verdict: null,
    allowlisted: false,
  };

  const msg = parseRequest(raw);
  if (!msg) return empty;
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'analyze_page': {
      const { features } = msg;
      const pageDomain = features.displayDomain || registrableDomain(
        (() => {
          try {
            return new URL(features.origin).hostname;
          } catch {
            return '';
          }
        })(),
      );
      const allowlisted = await isAllowlisted(pageDomain);
      const trustedDomain = brandForDomain(pageDomain) !== undefined;
      const reported = await getReportedSite(pageDomain);

      const results = runAnalyzers({
        features,
        pageDomain,
        allowlisted,
        userReportedAt: reported?.reportedAt ?? null,
      });
      const verdict = computeVerdict({ results, trustedDomain, allowlisted });

      if (typeof tabId === 'number') {
        await cacheVerdict(tabId, verdict);
        await setBadge(tabId, verdict);
      }
      return { source: MESSAGE_SOURCE, type: 'verdict', verdict, allowlisted };
    }

    case 'get_verdict': {
      const id = msg.tabId ?? tabId;
      if (typeof id !== 'number') return empty;
      const verdict = await getCachedVerdict(id);
      const domain = await domainForTab(id);
      const allowlisted = domain ? await isAllowlisted(domain) : false;
      return { source: MESSAGE_SOURCE, type: 'verdict', verdict, allowlisted };
    }

    case 'set_allowlist': {
      await setAllowlisted(msg.domain, msg.allowed);
      // Re-badge the active tab optimistically; next analyze pass will refine.
      if (typeof tabId === 'number' && msg.allowed) await setBadge(tabId, null);
      return { source: MESSAGE_SOURCE, type: 'verdict', verdict: null, allowlisted: msg.allowed };
    }

    case 'close_tab': {
      // Close the requesting tab via the tabs API (a content-script window.close()
      // is refused for tabs the page didn't open). No "tabs" permission needed.
      if (typeof tabId === 'number') {
        try {
          await browser.tabs.remove(tabId);
        } catch {
          /* tab already gone */
        }
      }
      return empty;
    }

    case 'report_site': {
      // Forward to every enabled authority (background so we bypass CORS), then
      // record locally so future visits are flagged (plan §12).
      const submissions = await runReporters(msg.url);
      const existing = await getReportedSite(msg.domain);
      const cachedScore =
        typeof tabId === 'number' ? (await getCachedVerdict(tabId))?.score : undefined;
      await saveReport({
        domain: msg.domain,
        url: msg.url,
        reportedAt: existing?.reportedAt ?? Date.now(),
        scoreAtReport: cachedScore ?? existing?.scoreAtReport,
        submissions: submissions.map((s) => ({
          authority: s.authority,
          status: s.status,
          detail: s.detail,
          at: Date.now(),
        })),
      });
      return {
        source: MESSAGE_SOURCE,
        type: 'report_result',
        reported: true,
        submissions,
      };
    }
  }
}

/**
 * Handle the optional AI-text ("slop") remote calls. Only the service worker
 * makes these cross-origin requests, and only when the user has (a) enabled
 * remote scanning with a configured endpoint and (b) granted host permission
 * for that endpoint's origin (requested from the popup, plan §8).
 */
async function handleSlopMessage(
  msg: SlopBackgroundRequest,
): Promise<SlopRemoteScanResponse | SlopHealthResponse> {
  if (msg.type === 'slop_health') {
    const origin = endpointOrigin(msg.endpoint);
    const ok = origin ? await hasOriginPermission(origin) && (await checkHealth(msg.endpoint)) : false;
    return { source: MESSAGE_SOURCE, type: 'slop_health_result', ok };
  }

  // slop_remote_scan
  const fail = (error: string): SlopRemoteScanResponse => ({
    source: MESSAGE_SOURCE,
    type: 'slop_remote_result',
    ok: false,
    segments: [],
    error,
  });

  const settings = await getSlopSettings();
  if (!remoteReady(settings)) return fail('remote disabled');
  const origin = endpointOrigin(settings.endpoint);
  if (!origin) return fail('invalid endpoint');
  if (!(await hasOriginPermission(origin))) return fail('permission not granted');
  if (!Array.isArray(msg.items) || msg.items.length === 0) return fail('no text');

  try {
    const segments = await scanSnippets(settings.endpoint, msg.items);
    return {
      source: MESSAGE_SOURCE,
      type: 'slop_remote_result',
      ok: true,
      segments,
      endpointHost: new URL(origin).host,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'request failed');
  }
}

/** Check whether the user has granted host permission for an endpoint origin. */
async function hasOriginPermission(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

/** Resolve a tab's registrable domain from its current URL, or '' if unavailable. */
async function domainForTab(tabId: number): Promise<string> {
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url) return '';
    return registrableDomain(new URL(tab.url).hostname);
  } catch {
    return '';
  }
}

/** Reflect risk on the toolbar badge (plan §3 toolbar state, §14 rating). */
async function setBadge(tabId: number, verdict: RiskVerdict | null): Promise<void> {
  const action = browser.action;
  if (!action) return;
  try {
    if (!verdict || verdict.action === 'allow') {
      await action.setBadgeText({ tabId, text: '' });
      await action.setTitle({ tabId, title: 'Fraud Watch — no risk signals' });
      return;
    }
    const color =
      verdict.action === 'block'
        ? '#ef4444'
        : verdict.action === 'step_up_confirm'
          ? '#f97316'
          : verdict.action === 'warn'
            ? '#f59e0b'
            : '#eab308';
    await action.setBadgeText({ tabId, text: String(verdict.rating) });
    await action.setBadgeBackgroundColor({ tabId, color });
    await action.setTitle({
      tabId,
      title: `Fraud Watch — risk ${verdict.rating}/10: ${verdict.userMessage}`,
    });
  } catch {
    /* tab may be gone */
  }
}
