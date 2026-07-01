import type { RiskVerdict } from '@/lib/types';

/**
 * Inline warning banner (plan §11). Calm, specific, actionable, and always
 * overridable. Rendered in a closed shadow root so hostile page CSS can't
 * hide or restyle it, and so we don't leak styles onto the page.
 *
 * Only shown for warn / step_up_confirm / block tiers. `caution` stays in the
 * toolbar only — no interruption (plan §7).
 */

const HOST_ID = 'fraud-watch-banner-host';

export interface BannerCallbacks {
  onDismiss: () => void;
  onAllowlist: () => void;
  onReport: () => void;
}

const TIER_STYLE: Record<
  string,
  { bg: string; accent: string; label: string }
> = {
  warn: { bg: '#7c4a03', accent: '#f59e0b', label: 'Caution' },
  step_up_confirm: { bg: '#7c2d12', accent: '#f97316', label: 'Warning' },
  block: { bg: '#7f1d1d', accent: '#ef4444', label: 'Danger' },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function removeBanner(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function renderBanner(verdict: RiskVerdict, cb: BannerCallbacks): void {
  if (verdict.action === 'allow' || verdict.action === 'caution') {
    removeBanner();
    return;
  }
  removeBanner();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const tier = TIER_STYLE[verdict.action] ?? TIER_STYLE.warn!;
  const evidenceItems = verdict.evidence
    .slice(0, 4)
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join('');
  const continueLabel =
    verdict.action === 'block' ? 'I understand the risk, continue' : 'Dismiss';

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .bar {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: ${tier.bg};
        color: #fff;
        border-bottom: 3px solid ${tier.accent};
        box-shadow: 0 4px 24px rgba(0,0,0,.35);
        padding: 14px 18px;
        display: flex;
        gap: 14px;
        align-items: flex-start;
        line-height: 1.4;
      }
      .icon { font-size: 22px; line-height: 1; flex: 0 0 auto; margin-top: 2px; }
      .body { flex: 1 1 auto; min-width: 0; }
      .tag {
        display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .06em;
        text-transform: uppercase; background: ${tier.accent}; color: #1a1a1a;
        padding: 2px 7px; border-radius: 4px; margin-bottom: 6px;
      }
      .headline { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
      .rating { font-weight: 400; opacity: .85; font-size: 13px; }
      ul { margin: 6px 0 10px; padding-left: 18px; font-size: 13px; }
      li { margin: 2px 0; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      button {
        font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        border-radius: 6px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.35);
        background: rgba(255,255,255,.12); color: #fff;
      }
      button:hover { background: rgba(255,255,255,.22); }
      button.primary { background: #fff; color: #111; border-color: #fff; }
      .close { margin-left: auto; background: transparent; border: none; font-size: 18px; padding: 0 4px; }
    </style>
    <div class="bar" role="alertdialog" aria-label="Fraud Watch warning">
      <div class="icon">${verdict.action === 'block' ? '🛑' : '⚠️'}</div>
      <div class="body">
        <span class="tag">${tier.label}</span>
        <span class="rating">· Risk ${verdict.rating}/10</span>
        <p class="headline">${escapeHtml(verdict.userMessage)}</p>
        <ul>${evidenceItems}</ul>
        <div class="actions">
          <button class="primary" data-act="close">Leave / close this page</button>
          <button data-act="report">Report site</button>
          <button data-act="allow">Trust this site</button>
          <button data-act="continue">${escapeHtml(continueLabel)}</button>
        </div>
      </div>
      <button class="close" data-act="continue" aria-label="Dismiss">×</button>
    </div>
  `;

  shadow.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const act = target?.getAttribute('data-act');
    if (!act) return;
    switch (act) {
      case 'close':
        // Best-effort: many pages block window.close(); navigate away as fallback.
        removeBanner();
        try {
          window.close();
        } catch {
          /* ignore */
        }
        location.replace('about:blank');
        break;
      case 'report': {
        cb.onReport();
        const btn = target as HTMLButtonElement;
        btn.textContent = 'Reported ✓';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        break;
      }
      case 'allow':
        cb.onAllowlist();
        removeBanner();
        break;
      case 'continue':
        cb.onDismiss();
        removeBanner();
        break;
    }
  });

  (document.documentElement || document.body).appendChild(host);
}
