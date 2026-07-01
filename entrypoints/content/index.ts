import { defineContentScript } from 'wxt/utils/define-content-script';
import { browser } from 'wxt/browser';
import {
  MESSAGE_SOURCE,
  type AnalyzePageMessage,
  type ReportSiteMessage,
  type RiskVerdict,
  type SetAllowlistMessage,
  type VerdictResponse,
} from '@/lib/types';
import { extractPageFeatures } from './extract';
import { renderBanner, removeBanner } from './banner';
import { runAiScan, clearHighlights } from './slop';
import { getSlopSettings } from '@/lib/slop/settings';
import type { SlopReportResponse, TabScanRequest } from '@/lib/slop/messages';

/**
 * Content-script orchestrator (plan §3). Least-trusted zone: it extracts
 * redacted evidence, asks the service worker for a verdict, and renders the
 * banner. It performs no scoring and holds no secrets.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    // Skip non-web and extension-internal contexts.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

    let lastVerdict: RiskVerdict | null = null;
    let dismissed = false;
    let inFlight = false;

    async function analyze(): Promise<void> {
      if (inFlight) return;
      inFlight = true;
      try {
        const features = extractPageFeatures();
        const msg: AnalyzePageMessage = {
          source: MESSAGE_SOURCE,
          type: 'analyze_page',
          features,
        };
        const res = (await browser.runtime.sendMessage(msg)) as
          | VerdictResponse
          | undefined;
        if (!res || res.source !== MESSAGE_SOURCE) return;
        lastVerdict = res.verdict;
        if (res.allowlisted || dismissed || !res.verdict) {
          removeBanner();
          return;
        }
        renderBanner(res.verdict, {
          onDismiss: () => {
            dismissed = true;
          },
          onAllowlist: () => {
            const allow: SetAllowlistMessage = {
              source: MESSAGE_SOURCE,
              type: 'set_allowlist',
              domain: features.displayDomain,
              allowed: true,
            };
            void browser.runtime.sendMessage(allow);
          },
          onReport: () => {
            // Record locally + forward to enabled authorities via the background
            // (which holds host permission and bypasses CORS). Fire-and-forget;
            // the banner gives immediate UI feedback itself.
            const report: ReportSiteMessage = {
              source: MESSAGE_SOURCE,
              type: 'report_site',
              url: location.href,
              domain: features.displayDomain,
            };
            void browser.runtime.sendMessage(report).catch(() => {});
          },
        });
      } catch (err) {
        // Service worker asleep/reloading is normal in MV3; fail quiet.
        console.debug('[Fraud Watch] analyze failed:', err);
      } finally {
        inFlight = false;
      }
    }

    // Popup-triggered AI-text scan / clear (arrives via tabs.sendMessage).
    // Async form: return a Promise whose resolved value is the response.
    browser.runtime.onMessage.addListener(async (raw: unknown) => {
      const msg = raw as Partial<TabScanRequest>;
      if (msg?.source !== MESSAGE_SOURCE) return undefined;
      if (msg.type === 'clear_ai_highlights') {
        clearHighlights();
        return { source: MESSAGE_SOURCE, type: 'slop_report', report: null } satisfies SlopReportResponse;
      }
      if (msg.type === 'run_ai_scan') {
        const report = await runAiScan(await getSlopSettings());
        return { source: MESSAGE_SOURCE, type: 'slop_report', report } satisfies SlopReportResponse;
      }
      return undefined;
    });

    // Initial pass.
    void analyze();

    // Re-analyze on significant DOM changes (new forms/overlays), debounced so
    // we don't thrash on every mutation (plan §15 Risk 5: latency).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void analyze(), 800);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Expose the last verdict to the popup via a runtime query is unnecessary —
    // the service worker caches it per tab. This variable is kept for potential
    // future in-page affordances.
    void lastVerdict;
  },
});
