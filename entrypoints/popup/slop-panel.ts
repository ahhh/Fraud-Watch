import { browser } from 'wxt/browser';
import { MESSAGE_SOURCE } from '@/lib/types';
import { getSlopSettings, setSlopSettings } from '@/lib/slop/settings';
import { endpointOrigin } from '@/lib/slop/sloptotal';
import type { SlopReport, SlopSettings } from '@/lib/slop/types';
import type {
  ClearHighlightsRequest,
  RunAiScanRequest,
  SlopHealthRequest,
  SlopHealthResponse,
  SlopReportResponse,
} from '@/lib/slop/messages';

/**
 * Popup panel for the optional AI-generated-text detector. Lets the user:
 *   - toggle the local heuristic (always offline),
 *   - scan / clear highlights on the active tab,
 *   - optionally point at a self-hosted sloptotal endpoint (opt-in, requests
 *     host permission for just that origin at click time).
 */

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const VERDICT_LABEL: Record<string, string> = {
  clean: 'Looks human-written',
  mixed: 'Mixed / uncertain',
  ai: 'Likely AI-generated',
};

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export async function renderSlopPanel(root: HTMLElement): Promise<void> {
  let settings = await getSlopSettings();

  function template(s: SlopSettings): string {
    return `
      <div class="slop-head">
        <label class="switch">
          <input type="checkbox" id="slop-enabled" ${s.enabled ? 'checked' : ''} />
          <span>AI-text detection</span>
        </label>
      </div>
      <div class="slop-body" ${s.enabled ? '' : 'hidden'}>
        <div class="actions">
          <button id="slop-scan">Scan this page</button>
          <button id="slop-clear">Clear</button>
        </div>
        <div id="slop-summary"></div>
        <details class="slop-remote" ${s.useRemote ? 'open' : ''}>
          <summary>Optional: sloptotal endpoint</summary>
          <p class="hint">
            Point at your own <a href="https://github.com/pablocaeg/sloptotal" target="_blank" rel="noreferrer">sloptotal</a>
            server for stronger detection. Enabling this sends scanned page text to that endpoint.
          </p>
          <input type="text" id="slop-endpoint" placeholder="http://localhost:8000"
                 value="${esc(s.endpoint)}" spellcheck="false" />
          <label class="switch small">
            <input type="checkbox" id="slop-remote" ${s.useRemote ? 'checked' : ''} />
            <span>Use this endpoint</span>
          </label>
          <div class="actions">
            <button id="slop-test">Test connection</button>
          </div>
          <div id="slop-status" class="hint"></div>
        </details>
      </div>`;
  }

  function paint(): void {
    root.innerHTML = template(settings);
    wire();
  }

  function setStatus(id: string, text: string, cls = ''): void {
    const node = document.getElementById(id);
    if (node) {
      node.textContent = text;
      node.className = `hint ${cls}`;
    }
  }

  function renderSummary(report: SlopReport | null): void {
    const box = document.getElementById('slop-summary');
    if (!box) return;
    if (!report) {
      box.innerHTML = '';
      return;
    }
    if (report.total === 0) {
      box.innerHTML = `<p class="hint">${esc(report.note ?? 'Nothing to analyze.')}</p>`;
      return;
    }
    const v = report.overallVerdict;
    box.innerHTML = `
      <div class="slop-result" data-v="${v}">
        <strong>${esc(VERDICT_LABEL[v] ?? v)}</strong>
        <span>· ${report.overallScore}/100 · ${report.aiCount}/${report.total} blocks flagged AI</span>
        <div class="hint">
          Source: ${report.source === 'remote' ? `sloptotal (${esc(report.endpointHost ?? 'remote')})` : 'local heuristic'}.
          ${report.note ? esc(report.note) : ''}
        </div>
      </div>`;
  }

  async function save(patch: Partial<SlopSettings>): Promise<void> {
    settings = await setSlopSettings(patch);
  }

  /** Ensure host permission for the current endpoint origin (user-gesture safe). */
  async function ensureEndpointPermission(): Promise<boolean> {
    const origin = endpointOrigin(settings.endpoint);
    if (!origin) {
      setStatus('slop-status', 'Enter a valid URL, e.g. http://localhost:8000', 'err');
      return false;
    }
    const pattern = `${origin}/*`;
    if (await browser.permissions.contains({ origins: [pattern] })) return true;
    try {
      return await browser.permissions.request({ origins: [pattern] });
    } catch {
      return false;
    }
  }

  function wire(): void {
    document.getElementById('slop-enabled')?.addEventListener('change', async (e) => {
      await save({ enabled: (e.target as HTMLInputElement).checked });
      paint();
    });

    document.getElementById('slop-scan')?.addEventListener('click', async () => {
      const tabId = await activeTabId();
      if (typeof tabId !== 'number') return;
      setStatus('slop-status', '');
      renderSummary(null);
      const btn = document.getElementById('slop-scan') as HTMLButtonElement | null;
      if (btn) btn.textContent = 'Scanning…';
      try {
        const msg: RunAiScanRequest = { source: MESSAGE_SOURCE, type: 'run_ai_scan' };
        const res = (await browser.tabs.sendMessage(tabId, msg)) as
          | SlopReportResponse
          | undefined;
        renderSummary(res?.report ?? null);
      } catch {
        renderSummary({
          segments: [], overallScore: 0, overallVerdict: 'clean', aiCount: 0,
          total: 0, source: 'local',
          note: 'Could not scan this page (try reloading it first).',
        });
      } finally {
        if (btn) btn.textContent = 'Scan this page';
      }
    });

    document.getElementById('slop-clear')?.addEventListener('click', async () => {
      const tabId = await activeTabId();
      if (typeof tabId !== 'number') return;
      const msg: ClearHighlightsRequest = {
        source: MESSAGE_SOURCE,
        type: 'clear_ai_highlights',
      };
      try {
        await browser.tabs.sendMessage(tabId, msg);
      } catch {
        /* no content script here */
      }
      renderSummary(null);
    });

    document.getElementById('slop-endpoint')?.addEventListener('change', async (e) => {
      await save({ endpoint: (e.target as HTMLInputElement).value });
    });

    document.getElementById('slop-remote')?.addEventListener('change', async (e) => {
      const on = (e.target as HTMLInputElement).checked;
      if (on) {
        await save({ endpoint: (document.getElementById('slop-endpoint') as HTMLInputElement)?.value ?? settings.endpoint });
        const granted = await ensureEndpointPermission();
        if (!granted) {
          (e.target as HTMLInputElement).checked = false;
          setStatus('slop-status', 'Host permission is required to use a remote endpoint.', 'err');
          return;
        }
      }
      await save({ useRemote: on });
      setStatus('slop-status', on ? 'Remote scanning enabled.' : 'Using local heuristic only.', on ? 'ok' : '');
    });

    document.getElementById('slop-test')?.addEventListener('click', async () => {
      await save({ endpoint: (document.getElementById('slop-endpoint') as HTMLInputElement)?.value ?? settings.endpoint });
      setStatus('slop-status', 'Testing…');
      if (!(await ensureEndpointPermission())) {
        setStatus('slop-status', 'Permission denied for that origin.', 'err');
        return;
      }
      const msg: SlopHealthRequest = {
        source: MESSAGE_SOURCE,
        type: 'slop_health',
        endpoint: settings.endpoint,
      };
      const res = (await browser.runtime.sendMessage(msg)) as SlopHealthResponse | undefined;
      setStatus(
        'slop-status',
        res?.ok ? 'Connected ✓ sloptotal is reachable.' : 'Could not reach that endpoint.',
        res?.ok ? 'ok' : 'err',
      );
    });
  }

  paint();
}
