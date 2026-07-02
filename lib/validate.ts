import {
  MESSAGE_SOURCE,
  type PageFeatures,
  type RequestMessage,
} from '@/lib/types';

/**
 * Message + evidence validation (plan §10 messaging security). Content scripts
 * are the least-trusted component; the service worker must validate and
 * sanitize everything they send before acting on it.
 */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Narrow an untrusted runtime message to a known RequestMessage, or null. */
export function parseRequest(raw: unknown): RequestMessage | null {
  if (!isObj(raw) || raw.source !== MESSAGE_SOURCE || typeof raw.type !== 'string') {
    return null;
  }
  switch (raw.type) {
    case 'analyze_page':
      return validatePageFeatures((raw as { features?: unknown }).features)
        ? (raw as unknown as RequestMessage)
        : null;
    case 'get_verdict':
      return raw as unknown as RequestMessage;
    case 'set_allowlist':
      return typeof (raw as { domain?: unknown }).domain === 'string' &&
        typeof (raw as { allowed?: unknown }).allowed === 'boolean'
        ? (raw as unknown as RequestMessage)
        : null;
    case 'report_site':
      return typeof (raw as { url?: unknown }).url === 'string' &&
        typeof (raw as { domain?: unknown }).domain === 'string'
        ? (raw as unknown as RequestMessage)
        : null;
    case 'close_tab':
      return raw as unknown as RequestMessage;
    default:
      return null;
  }
}

/** Structural validation of a PageFeatures bundle from the content script. */
export function validatePageFeatures(v: unknown): v is PageFeatures {
  if (!isObj(v)) return false;
  if (typeof v.origin !== 'string' || typeof v.displayDomain !== 'string') return false;
  if (typeof v.title !== 'string') return false;
  if (!isStringArray(v.visibleTextSnippets)) return false;
  if (!Array.isArray(v.forms) || !Array.isArray(v.links)) return false;
  if (!isObj(v.popup)) return false;
  const p = v.popup;
  if (
    typeof p.modalCount !== 'number' ||
    typeof p.fullscreenLike !== 'boolean' ||
    typeof p.systemWarningLanguage !== 'boolean' ||
    typeof p.remoteSupportLanguage !== 'boolean'
  ) {
    return false;
  }
  if (!isObj(v.scripts)) return false;
  const s = v.scripts;
  if (
    typeof s.exfilBeacon !== 'boolean' ||
    typeof s.ipLookup !== 'boolean' ||
    typeof s.paymentBeacon !== 'boolean'
  ) {
    return false;
  }
  return true;
}
