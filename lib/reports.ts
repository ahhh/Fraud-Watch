import { browser } from 'wxt/browser';

/**
 * Local "bad sites" list of user-reported domains (plan §12 report flow, §10
 * data minimization: we store only the domain, the reported URL, timestamps,
 * and submission outcomes — no page content).
 *
 * When the user clicks "Report site", the domain is recorded here and any
 * future visit is flagged as user-reported by the scoring pipeline
 * (see lib/analyzers/userReport.ts).
 */

const KEY = 'reported_sites';

export type SubmissionStatus = 'submitted' | 'skipped' | 'failed';

/** Outcome of trying to forward a report to one external authority. */
export interface ReportSubmission {
  authority: string; // reporter id, e.g. "ncsc"
  status: SubmissionStatus;
  detail?: string; // reason for skip/failure, or confirmation note
  at: number;
}

export interface ReportedSite {
  domain: string;
  url: string;
  reportedAt: number;
  /** Local risk score at the moment the user reported it, if known. */
  scoreAtReport?: number;
  /** Most recent external-authority submission results. */
  submissions: ReportSubmission[];
}

type ReportedMap = Record<string, ReportedSite>;

export async function getReportedSites(): Promise<ReportedMap> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as ReportedMap | undefined) ?? {};
}

export async function getReportedSite(domain: string): Promise<ReportedSite | null> {
  if (!domain) return null;
  return (await getReportedSites())[domain] ?? null;
}

export async function isReported(domain: string): Promise<boolean> {
  return (await getReportedSite(domain)) !== null;
}

/** Insert or update a reported site, merging in the latest submission results. */
export async function saveReport(entry: ReportedSite): Promise<void> {
  const all = await getReportedSites();
  all[entry.domain] = entry;
  await browser.storage.local.set({ [KEY]: all });
}

export async function removeReport(domain: string): Promise<void> {
  const all = await getReportedSites();
  if (domain in all) {
    delete all[domain];
    await browser.storage.local.set({ [KEY]: all });
  }
}
