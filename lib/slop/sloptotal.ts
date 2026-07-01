import {
  verdictForIndicator,
  verdictForScore,
  type QuickScoreResponse,
  type SlopSegment,
  type SnippetScanResponse,
} from './types';

/**
 * Client for a self-hosted sloptotal server
 * (https://github.com/pablocaeg/sloptotal). We only ever talk to the URL the
 * user configured — this project does not host sloptotal.
 *
 * Endpoints used (matching the reference extension's primary flows):
 *   POST /api/scan/snippets  — batch, id-addressable → DOM-aligned highlighting
 *   POST /api/quick-score    — single block (e.g. a selection)
 *   GET  /health             — validate an endpoint before enabling remote
 */

const DEFAULT_TIMEOUT_MS = 12_000;
/** sloptotal accepts 1–30 snippets per batch. */
export const MAX_SNIPPETS_PER_BATCH = 30;

export interface SnippetInput {
  id: string;
  text: string;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

/** Origin of an endpoint, for host-permission checks + user disclosure. */
export function endpointOrigin(endpoint: string): string | null {
  try {
    return new URL(endpoint).origin;
  } catch {
    return null;
  }
}

async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`sloptotal ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Quick liveness check so the popup can validate an endpoint before enabling. */
export async function checkHealth(endpoint: string, timeoutMs = 5000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(endpoint, '/health'), {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Batch-scan snippets and return normalized SlopSegments keyed by the ids we
 * sent, so the caller can map each result back to its DOM node.
 */
export async function scanSnippets(
  endpoint: string,
  items: SnippetInput[],
): Promise<SlopSegment[]> {
  if (items.length === 0) return [];
  const batch = items.slice(0, MAX_SNIPPETS_PER_BATCH);
  const data = await postJson<SnippetScanResponse>(
    joinUrl(endpoint, '/api/scan/snippets'),
    { snippets: batch.map((s) => ({ id: s.id, text: s.text, url: '' })) },
  );

  const byId = new Map(batch.map((s) => [s.id, s.text] as const));
  return (data.results ?? []).map((r) => {
    const text = byId.get(r.id) ?? '';
    return {
      id: r.id,
      textPreview: text.slice(0, 200),
      charCount: r.chars ?? text.length,
      score: r.score,
      verdict: verdictForIndicator(r.indicator),
      confidence: r.confidence,
      source: 'remote' as const,
      reasons: [],
    };
  });
}

/** Score a single block (used for a text selection). Requires >= 50 chars server-side. */
export async function quickScore(
  endpoint: string,
  text: string,
): Promise<SlopSegment> {
  const data = await postJson<QuickScoreResponse>(
    joinUrl(endpoint, '/api/quick-score'),
    { text },
  );
  const verdict =
    data.verdict === 'ai' || data.verdict === 'mixed' || data.verdict === 'clean'
      ? data.verdict
      : verdictForScore(data.score);
  return {
    id: 'selection',
    textPreview: text.slice(0, 200),
    charCount: text.length,
    score: data.score,
    verdict,
    confidence: data.confidence,
    source: 'remote',
    reasons: [],
  };
}
