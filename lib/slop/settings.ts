import { browser } from 'wxt/browser';
import { DEFAULT_SLOP_SETTINGS, type SlopSettings } from './types';

/**
 * Persisted settings for the AI-text detector (plan §10 data minimization: we
 * store only preferences, never scanned content).
 */

const KEY = 'slop_settings';

export async function getSlopSettings(): Promise<SlopSettings> {
  const stored = await browser.storage.local.get(KEY);
  const s = (stored[KEY] as Partial<SlopSettings> | undefined) ?? {};
  return { ...DEFAULT_SLOP_SETTINGS, ...s };
}

export async function setSlopSettings(patch: Partial<SlopSettings>): Promise<SlopSettings> {
  const next = { ...(await getSlopSettings()), ...patch };
  // Normalize the endpoint (strip trailing slash, tolerate blank).
  next.endpoint = next.endpoint.trim().replace(/\/+$/, '');
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** True only when a remote scan can actually be attempted. */
export function remoteReady(s: SlopSettings): boolean {
  return s.enabled && s.useRemote && s.endpoint.length > 0;
}
