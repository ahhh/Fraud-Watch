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
  /** Close the current tab (delegated to the background tabs API). */
  onCloseTab: () => void;
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

  const isBlock = verdict.action === 'block';
  const host = document.createElement('div');
  host.id = HOST_ID;
  // Block takes over the top half of the viewport; warn/step-up stay a slim bar.
  host.style.cssText =
    'all: initial; position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const tier = TIER_STYLE[verdict.action] ?? TIER_STYLE.warn!;
  const evidenceItems = verdict.evidence
    .slice(0, isBlock ? 6 : 4)
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join('');
  const continueLabel = isBlock ? 'Ignore and continue anyway' : 'Dismiss';

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
      /* Block: a large, unmissable red panel filling the top ~55% of the screen. */
      .bar.block {
        min-height: 55vh;
        box-sizing: border-box;
        background: linear-gradient(180deg, #991b1b 0%, #7f1d1d 100%);
        border-bottom: 6px solid #ef4444;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 32px 24px;
        gap: 10px;
      }
      .icon { font-size: 22px; line-height: 1; flex: 0 0 auto; margin-top: 2px; }
      .block .icon { font-size: 56px; margin: 0; }
      .body { flex: 1 1 auto; min-width: 0; }
      .block .body { flex: 0 0 auto; max-width: 720px; }
      .tag {
        display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .06em;
        text-transform: uppercase; background: ${tier.accent}; color: #1a1a1a;
        padding: 2px 7px; border-radius: 4px; margin-bottom: 6px;
      }
      .block .tag { font-size: 13px; padding: 4px 12px; }
      .headline { font-size: 15px; font-weight: 700; margin: 0 0 6px; }
      .block .headline { font-size: 28px; margin: 10px 0 12px; }
      .rating { font-weight: 400; opacity: .85; font-size: 13px; }
      ul { margin: 6px 0 10px; padding-left: 18px; font-size: 13px; }
      .block ul { display: inline-block; text-align: left; font-size: 15px; margin: 4px auto 18px; }
      li { margin: 2px 0; }
      .block li { margin: 6px 0; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      .block .actions { justify-content: center; gap: 12px; margin-top: 8px; }
      button {
        font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
        border-radius: 6px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.35);
        background: rgba(255,255,255,.12); color: #fff;
      }
      button:hover { background: rgba(255,255,255,.22); }
      button.primary { background: #fff; color: #111; border-color: #fff; }
      /* The highlighted, recommended action on a block panel. */
      .block button.primary {
        font-size: 18px; font-weight: 800; padding: 14px 28px; border-radius: 10px;
        background: #fff; color: #7f1d1d; box-shadow: 0 6px 20px rgba(0,0,0,.35);
      }
      .block button.primary:hover { background: #ffe4e6; }
      .block button:not(.primary) { font-size: 13px; opacity: .9; }
      .close { margin-left: auto; background: transparent; border: none; font-size: 18px; padding: 0 4px; }
      .block .close { position: absolute; top: 12px; right: 16px; margin: 0; }
    </style>
    <div class="bar ${isBlock ? 'block' : ''}" role="alertdialog" aria-label="Fraud Watch warning">
      <div class="icon">${isBlock ? '🛑' : '⚠️'}</div>
      <div class="body">
        <span class="tag">${tier.label}</span>
        <span class="rating">· Risk ${verdict.rating}/10</span>
        <p class="headline">${escapeHtml(verdict.userMessage)}</p>
        <ul>${evidenceItems}</ul>
        <div class="actions">
          <button class="primary" data-act="leave">Leave this page</button>
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
      case 'leave':
        // Take the user back where they came from. If there's no history, ask
        // the background to close the tab via the tabs API — a content-script
        // window.close() is refused (and logs a warning) for tabs the page's own
        // scripts didn't open. We never blank/replace the page.
        if (history.length > 1) {
          history.back();
        } else {
          cb.onCloseTab();
        }
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
