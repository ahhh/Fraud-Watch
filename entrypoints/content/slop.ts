import { browser } from 'wxt/browser';
import { MESSAGE_SOURCE } from '@/lib/types';
import {
  localSegment,
  scoreTextLocally,
  localConfidence,
} from '@/lib/slop/heuristics';
import {
  verdictForScore,
  type SlopReport,
  type SlopSegment,
  type SlopSettings,
} from '@/lib/slop/types';
import type {
  SlopRemoteScanRequest,
  SlopRemoteScanResponse,
} from '@/lib/slop/messages';

/**
 * On-page AI-text scan + highlighting (plan-style content-script feature).
 *
 * Flow: collect visible prose blocks → score each locally (always) → if the
 * user enabled a remote sloptotal endpoint, ask the background to batch-scan
 * the same blocks and override scores by id → highlight each block inline,
 * colour-coded, with a score badge and reason tooltip. Fully reversible.
 */

const STYLE_ID = 'fraud-watch-slop-style';
const ATTR = 'data-fw-slop'; // verdict marker on highlighted blocks
const ID_ATTR = 'data-fw-slop-id'; // stable id for mapping remote results back
const BADGE_CLASS = 'fw-slop-badge';

/** Live registry of the elements we highlighted, keyed by segment id. */
const highlighted = new Map<string, HTMLElement>();

// --- collection -------------------------------------------------------------

const BLOCK_SELECTOR = 'p, li, blockquote, dd, article > div, section > div';

function isVisible(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
    return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Gather candidate prose blocks with enough text, capped for batch limits. */
function collectBlocks(minChars: number, max = 30): Array<{ id: string; el: HTMLElement; text: string }> {
  const out: Array<{ id: string; el: HTMLElement; text: string }> = [];
  const seen = new Set<string>();
  const nodes = document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  let n = 0;
  for (const el of Array.from(nodes)) {
    if (el.closest(`.${BADGE_CLASS}`) || el.id === 'fraud-watch-banner-host') continue;
    // Skip blocks that merely wrap other blocks (avoid double-counting).
    if (el.querySelector(BLOCK_SELECTOR)) continue;
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < minChars) continue;
    if (!isVisible(el)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ id: `s${n}`, el, text });
    n++;
    if (out.length >= max) break;
  }
  return out;
}

// --- highlighting -----------------------------------------------------------

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${ATTR}="ai"] { background: rgba(239,68,68,.16) !important; box-shadow: inset 3px 0 0 #ef4444 !important; }
    [${ATTR}="mixed"] { background: rgba(245,158,11,.14) !important; box-shadow: inset 3px 0 0 #f59e0b !important; }
    [${ATTR}="clean"] { box-shadow: inset 3px 0 0 rgba(34,197,94,.5) !important; }
    .${BADGE_CLASS} {
      display: inline-block; vertical-align: super; margin-left: 6px;
      font: 700 10px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #fff; padding: 1px 5px; border-radius: 4px; cursor: help; user-select: none;
      white-space: nowrap;
    }
    .${BADGE_CLASS}[data-v="ai"] { background: #ef4444; }
    .${BADGE_CLASS}[data-v="mixed"] { background: #d97706; }
    .${BADGE_CLASS}[data-v="clean"] { background: #16a34a; }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function badgeText(seg: SlopSegment): string {
  const label = seg.verdict === 'ai' ? 'AI' : seg.verdict === 'mixed' ? 'Mixed' : 'Human';
  return `${label} ${Math.round(seg.score)}`;
}

function applyHighlight(el: HTMLElement, seg: SlopSegment): void {
  el.setAttribute(ATTR, seg.verdict);
  el.setAttribute(ID_ATTR, seg.id);
  // Remove any stale badge from a previous pass.
  el.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
  const badge = document.createElement('span');
  badge.className = BADGE_CLASS;
  badge.setAttribute('data-v', seg.verdict);
  badge.textContent = badgeText(seg);
  const tip = [
    `AI-likelihood: ${Math.round(seg.score)}/100 (${seg.confidence} confidence, ${seg.source})`,
    ...seg.reasons,
  ].join('\n');
  badge.title = tip;
  el.appendChild(badge);
  highlighted.set(seg.id, el);
}

export function clearHighlights(): void {
  for (const el of highlighted.values()) {
    el.removeAttribute(ATTR);
    el.removeAttribute(ID_ATTR);
    el.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
  }
  highlighted.clear();
  document.getElementById(STYLE_ID)?.remove();
}

// --- report -----------------------------------------------------------------

function buildReport(segments: SlopSegment[], source: SlopReport['source'], extra?: Partial<SlopReport>): SlopReport {
  const totalChars = segments.reduce((a, s) => a + Math.max(1, s.charCount), 0);
  const overallScore =
    segments.length === 0
      ? 0
      : Math.round(
          segments.reduce((a, s) => a + s.score * Math.max(1, s.charCount), 0) / totalChars,
        );
  return {
    segments,
    overallScore,
    overallVerdict: verdictForScore(overallScore),
    aiCount: segments.filter((s) => s.verdict === 'ai').length,
    total: segments.length,
    source,
    ...extra,
  };
}

// --- scan orchestration -----------------------------------------------------

async function requestRemote(
  items: Array<{ id: string; text: string }>,
): Promise<SlopRemoteScanResponse | null> {
  const msg: SlopRemoteScanRequest = {
    source: MESSAGE_SOURCE,
    type: 'slop_remote_scan',
    items,
  };
  try {
    const res = (await browser.runtime.sendMessage(msg)) as
      | SlopRemoteScanResponse
      | undefined;
    return res && res.source === MESSAGE_SOURCE ? res : null;
  } catch {
    return null;
  }
}

/** Run a full scan of the current page and highlight results. */
export async function runAiScan(settings: SlopSettings): Promise<SlopReport> {
  clearHighlights();
  if (!settings.enabled) {
    return buildReport([], 'local', { note: 'AI-text detection is turned off.' });
  }

  const blocks = collectBlocks(settings.minChars);
  if (blocks.length === 0) {
    return buildReport([], 'local', { note: 'No substantial text blocks found to analyze.' });
  }

  // 1. Always compute the local heuristic first (offline, instant).
  const local = new Map<string, SlopSegment>();
  for (const b of blocks) local.set(b.id, localSegment(b.id, b.text));

  let segments = [...local.values()];
  let source: SlopReport['source'] = 'local';
  let note: string | undefined;
  let endpointHost: string | undefined;

  // 2. Optionally refine with the remote sloptotal endpoint.
  const wantRemote = settings.useRemote && settings.endpoint.length > 0;
  if (wantRemote) {
    const res = await requestRemote(blocks.map((b) => ({ id: b.id, text: b.text })));
    if (res?.ok && res.segments.length > 0) {
      // Override local by id; keep local for any ids the server skipped.
      const merged = new Map(local);
      for (const seg of res.segments) merged.set(seg.id, seg);
      segments = [...merged.values()];
      source = 'remote';
      endpointHost = res.endpointHost;
    } else {
      note = res?.error
        ? `Remote sloptotal unavailable (${res.error}); showing local heuristic.`
        : 'Remote sloptotal unavailable; showing local heuristic.';
    }
  }

  // 3. Highlight (only flag mixed/ai to avoid painting the whole page green).
  ensureStyle();
  const byId = new Map(blocks.map((b) => [b.id, b.el] as const));
  for (const seg of segments) {
    if (seg.verdict === 'clean') continue;
    const el = byId.get(seg.id);
    if (el) applyHighlight(el, seg);
  }

  return buildReport(segments, source, { note, endpointHost });
}

// --- selection convenience --------------------------------------------------

/** Score the current text selection locally (used when the user highlights text). */
export function scoreSelectionLocally(): SlopSegment | null {
  const sel = window.getSelection()?.toString().trim() ?? '';
  if (sel.length < 40) return null;
  const { score, reasons } = scoreTextLocally(sel);
  return {
    id: 'selection',
    textPreview: sel.slice(0, 200),
    charCount: sel.length,
    score,
    verdict: verdictForScore(score),
    confidence: localConfidence(sel.length),
    source: 'local',
    reasons,
  };
}
