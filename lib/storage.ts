import { browser } from 'wxt/browser';
import type { RiskVerdict } from '@/lib/types';

/**
 * Local stores (plan §3). Two tiers:
 *   - storage.local   : persistent user prefs + allowlist (survives restarts)
 *   - storage.session : per-tab verdict cache (cleared on browser shutdown),
 *     so the popup can read a verdict even if the MV3 service worker was
 *     killed and restarted between messages.
 *
 * We never store page content or secrets here — only computed verdicts and
 * user preferences (plan §10 data minimization).
 */

const ALLOWLIST_KEY = 'allowlist';
const verdictKey = (tabId: number) => `verdict:${tabId}`;

// --- Allowlist (persistent) -------------------------------------------------

export async function getAllowlist(): Promise<Set<string>> {
  const stored = await browser.storage.local.get(ALLOWLIST_KEY);
  const arr = (stored[ALLOWLIST_KEY] as string[] | undefined) ?? [];
  return new Set(arr);
}

export async function isAllowlisted(domain: string): Promise<boolean> {
  return (await getAllowlist()).has(domain);
}

export async function setAllowlisted(domain: string, allowed: boolean): Promise<void> {
  const set = await getAllowlist();
  if (allowed) set.add(domain);
  else set.delete(domain);
  await browser.storage.local.set({ [ALLOWLIST_KEY]: [...set] });
}

// --- Per-tab verdict cache (session) ---------------------------------------

export async function cacheVerdict(tabId: number, verdict: RiskVerdict): Promise<void> {
  await browser.storage.session.set({ [verdictKey(tabId)]: verdict });
}

export async function getCachedVerdict(tabId: number): Promise<RiskVerdict | null> {
  const stored = await browser.storage.session.get(verdictKey(tabId));
  return (stored[verdictKey(tabId)] as RiskVerdict | undefined) ?? null;
}

export async function clearVerdict(tabId: number): Promise<void> {
  await browser.storage.session.remove(verdictKey(tabId));
}
