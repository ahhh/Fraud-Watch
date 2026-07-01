import { MESSAGE_SOURCE } from '@/lib/types';
import type { SlopReport, SlopSegment } from './types';

/**
 * Messaging for the AI-text detector. Two channels:
 *   popup  -> content  (via tabs.sendMessage): run / clear a scan on the page
 *   content-> background (via runtime.sendMessage): perform the remote fetch,
 *     since only the service worker holds the optional host permission.
 */

// --- popup -> content -------------------------------------------------------

export interface RunAiScanRequest {
  source: typeof MESSAGE_SOURCE;
  type: 'run_ai_scan';
}
export interface ClearHighlightsRequest {
  source: typeof MESSAGE_SOURCE;
  type: 'clear_ai_highlights';
}
export type TabScanRequest = RunAiScanRequest | ClearHighlightsRequest;

/** content -> popup reply to a run_ai_scan. */
export interface SlopReportResponse {
  source: typeof MESSAGE_SOURCE;
  type: 'slop_report';
  report: SlopReport | null;
}

// --- content -> background --------------------------------------------------

export interface SlopRemoteScanRequest {
  source: typeof MESSAGE_SOURCE;
  type: 'slop_remote_scan';
  items: Array<{ id: string; text: string }>;
}
export interface SlopRemoteScanResponse {
  source: typeof MESSAGE_SOURCE;
  type: 'slop_remote_result';
  ok: boolean;
  segments: SlopSegment[];
  endpointHost?: string;
  error?: string;
}

// --- popup -> background (endpoint validation) ------------------------------

export interface SlopHealthRequest {
  source: typeof MESSAGE_SOURCE;
  type: 'slop_health';
  endpoint: string;
}
export interface SlopHealthResponse {
  source: typeof MESSAGE_SOURCE;
  type: 'slop_health_result';
  ok: boolean;
}

export type SlopBackgroundRequest = SlopRemoteScanRequest | SlopHealthRequest;

/** True for any slop message the background should handle (before core parsing). */
export function isSlopMessage(raw: unknown): raw is SlopBackgroundRequest {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { source?: unknown }).source === MESSAGE_SOURCE &&
    ((raw as { type?: unknown }).type === 'slop_remote_scan' ||
      (raw as { type?: unknown }).type === 'slop_health')
  );
}
