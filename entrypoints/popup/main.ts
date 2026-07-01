import { browser, type Browser } from 'wxt/browser';
import {
  MESSAGE_SOURCE,
  type GetVerdictMessage,
  type ReportAuthorityResult,
  type ReportResultResponse,
  type ReportSiteMessage,
  type RiskVerdict,
  type SetAllowlistMessage,
  type VerdictResponse,
} from '@/lib/types';
import { registrableDomain } from '@/lib/domain';
import { NCSC_ORIGIN_PATTERN } from '@/lib/reporters/ncsc';
import { renderSlopPanel } from './slop-panel';

/** URL of the active tab, captured in main() for the report action. */
let activeUrl = '';

/**
 * Toolbar popup (plan §3 UI surfaces, §11). Reads the cached verdict for the
 * active tab and renders the site risk rating, categories, and an explainable
 * per-analyzer breakdown ("how it was calculated"). Lets the user allowlist
 * ("trust this site") — an override that must always be available (plan §7).
 */

const RATING_COLORS = ['#22c55e', '#84cc16', '#eab308', '#f59e0b', '#ef4444'];
function ratingColor(rating: number): string {
  return RATING_COLORS[Math.min(RATING_COLORS.length - 1, Math.floor((rating - 1) / 2))]!;
}

const TIER_LABEL: Record<string, string> = {
  allow: 'No warning',
  caution: 'Passive caution',
  warn: 'Inline warning',
  step_up_confirm: 'Confirm before acting',
  block: 'Blocked / interstitial',
};

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

async function activeTab(): Promise<Browser.tabs.Tab | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function render(verdict: RiskVerdict | null, domain: string, allowlisted: boolean): void {
  const content = el('content');

  if (allowlisted) {
    content.innerHTML = `
      <div class="gauge">
        <div class="score" style="background:#22c55e">✓</div>
        <div>
          <p class="headline">You trust this site</p>
          <span class="tier">Warnings are suppressed for ${escapeHtml(domain)}.</span>
        </div>
      </div>
      <div class="actions"><button id="allow-toggle" class="on">Stop trusting</button></div>`;
    wireAllowlist(domain, true);
    return;
  }

  if (!verdict) {
    content.innerHTML = `<p class="loading">No analysis yet. Reload the page to scan it.</p>`;
    return;
  }

  const cats = verdict.categories
    .map((c) => `<span class="chip">${escapeHtml(c.replace(/_/g, ' '))}</span>`)
    .join('');
  const evidence = verdict.evidence
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join('');
  const breakdown = verdict.breakdown
    .map(
      (r) =>
        `<div class="row"><span>${escapeHtml(r.id.replace(/_/g, ' '))}</span><span class="pts">+${r.score}</span></div>`,
    )
    .join('');

  content.innerHTML = `
    <div class="gauge">
      <div class="score" style="background:${ratingColor(verdict.rating)}">
        ${verdict.rating}<small>/10</small>
      </div>
      <div>
        <p class="headline">${escapeHtml(verdict.userMessage)}</p>
        <span class="tier">${TIER_LABEL[verdict.action] ?? verdict.action} · score ${verdict.score}/100</span>
      </div>
    </div>
    ${cats ? `<div class="cats">${cats}</div>` : ''}
    ${evidence ? `<h4>Why</h4><ul class="evidence">${evidence}</ul>` : ''}
    ${
      breakdown
        ? `<div class="breakdown"><h4>How it was calculated</h4>${breakdown}</div>`
        : ''
    }
    <div class="actions">
      <button id="allow-toggle">Trust this site</button>
      <button id="report">Report site</button>
    </div>
    <div id="report-status" class="hint"></div>`;

  wireAllowlist(domain, false);
  wireReport(domain);
}

/** Render each authority's submission outcome under the report button. */
function renderReportStatus(submissions: ReportAuthorityResult[]): void {
  const box = document.getElementById('report-status');
  if (!box) return;
  const icon = (s: string) => (s === 'submitted' ? '✓' : s === 'failed' ? '✕' : '–');
  box.innerHTML = submissions
    .map(
      (s) =>
        `<div class="row"><span>${icon(s.status)} ${escapeHtml(s.label)}</span>` +
        `<span class="pts">${escapeHtml(s.detail ?? s.status)}</span></div>`,
    )
    .join('');
}

function wireReport(domain: string): void {
  const btn = document.getElementById('report') as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Reporting…';
    // One-time opt-in: grant NCSC host permission so the background can POST the
    // report. This click is the required user gesture. Local recording happens
    // regardless of whether permission is granted.
    try {
      const has = await browser.permissions.contains({ origins: [NCSC_ORIGIN_PATTERN] });
      if (!has) await browser.permissions.request({ origins: [NCSC_ORIGIN_PATTERN] });
    } catch {
      /* proceed; background will mark NCSC skipped if permission is missing */
    }
    const msg: ReportSiteMessage = {
      source: MESSAGE_SOURCE,
      type: 'report_site',
      url: activeUrl,
      domain,
    };
    const res = (await browser.runtime.sendMessage(msg)) as ReportResultResponse | undefined;
    btn.textContent = 'Reported ✓';
    if (res?.submissions) renderReportStatus(res.submissions);
  });
}

function wireAllowlist(domain: string, allowlisted: boolean): void {
  const btn = document.getElementById('allow-toggle');
  if (!btn || !domain) return;
  btn.addEventListener('click', async () => {
    const msg: SetAllowlistMessage = {
      source: MESSAGE_SOURCE,
      type: 'set_allowlist',
      domain,
      allowed: !allowlisted,
    };
    await browser.runtime.sendMessage(msg);
    render(null, domain, !allowlisted);
  });
}

async function main(): Promise<void> {
  // The AI-text panel is independent of the fraud verdict; render it first so
  // it appears even on pages with no risk signal.
  void renderSlopPanel(el('slop'));

  const tab = await activeTab();
  activeUrl = tab?.url ?? '';
  let domain = '';
  try {
    domain = tab?.url ? registrableDomain(new URL(tab.url).hostname) : '';
  } catch {
    domain = '';
  }
  el('domain').textContent = domain || '—';

  if (typeof tab?.id !== 'number') {
    render(null, domain, false);
    return;
  }

  const req: GetVerdictMessage = {
    source: MESSAGE_SOURCE,
    type: 'get_verdict',
    tabId: tab.id,
  };
  const res = (await browser.runtime.sendMessage(req)) as VerdictResponse | undefined;
  render(res?.verdict ?? null, domain, res?.allowlisted ?? false);
}

void main();
