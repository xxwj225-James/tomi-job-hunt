/**
 * Boss直聘 job detail page (zhipin.com/job_detail/*):
 * JD extraction → floating TomiHunt panel → greeting pitch → handoff to the
 * chat page (立即沟通 navigates to /web/geek/chat/*, handled by zhipin-chat.ts).
 *
 * Extraction strategy (from live research, 2026-08):
 *   1. Same-origin JSON API `/wapi/zpgeek/job/detail.json` — plaintext salary
 *      (the DOM salary uses a dynamic per-session obfuscation font) and clean JD
 *   2. DOM fallback with current selectors (`.job-detail-header .job-name` …)
 *      plus legacy candidates; hidden interference words stripped in shared.ts
 */
import { captureAndShow, pickLongText, pickText } from './shared.js';
import type { JdCaptureInput } from '../types.js';

export interface ZhipinJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName: string;
}

const DETAIL_API = '/wapi/zpgeek/job/detail.json';

/** Extracts the jid from job_detail/<jid>.html URLs. */
export function jidFromUrl(url: string): string | null {
  const match = url.match(/job_detail\/([^/.?#]+)/);
  return match?.[1] ?? null;
}

/** Defensive parse of the wapi detail response (schema drifts across versions). */
export function parseWapiDetail(json: unknown): ZhipinJd | null {
  const root = (json as { zpData?: { jobDetail?: Record<string, unknown> } })?.zpData?.jobDetail;
  if (!root) return null;
  const str = (...paths: string[]): string =>
    paths
      .map((p) => root[p])
      .find((v): v is string => typeof v === 'string' && v.trim().length > 0)
      ?.trim() ?? '';
  const title = str('jobName', 'title', 'jobTitle');
  const company = str('brandName', 'companyName', 'brandShortName');
  if (!title || !company) return null;
  return {
    title,
    company,
    salaryText: str('salaryDesc', 'salary'),
    requirements: str('postDescription', 'jdText', 'jobDescription'),
    hrName: str('bossName', 'recruiterName', 'bossTitle'),
  };
}

/** DOM fallback extraction with current + legacy selector candidates. */
export function extractZhipinJdDom(doc: Document): ZhipinJd | null {
  const title =
    pickText(doc, ['.job-detail-header .job-name', '.job-title', '.job-name h1', '.name h1', 'h1']) || '';
  const company =
    pickText(doc, [
      '.job-detail-header .job-company-name',
      '.boss-name',
      '.company-name',
      '.company-text',
      '.company-info .name',
      '.job-company .name',
    ]) || '';
  if (!title || !company) return null;

  const salaryText =
    pickText(doc, [
      '.job-detail-header .job-salary',
      '.job-salary',
      '.salary',
      '.job-title-box .salary',
    ]) || '';
  const requirements =
    pickLongText(doc, [
      '.job-detail .job-keyword-list + .job-sec-text',
      '.job-detail-section .job-sec-text',
      '.job-sec-text',
      '.job-description',
      '.job-detail .text',
      '.job-sec .text',
    ]) || '';
  const hrName =
    pickText(doc, [
      '.job-boss-info h2.name',
      '.job-boss .name',
      '.boss-info .name',
      '.recruiter-name',
    ]) || '';

  return { title, company, salaryText, requirements, hrName };
}

export async function extractZhipinJd(doc: Document): Promise<ZhipinJd | null> {
  const jid = jidFromUrl(doc.location?.href ?? '');
  if (jid) {
    try {
      const resp = await fetch(`${DETAIL_API}?jid=${jid}&lid=&securityId=`, { credentials: 'include' });
      if (resp.ok) {
        const apiJd = parseWapiDetail(await resp.json());
        if (apiJd && apiJd.requirements) return apiJd;
        if (apiJd) return { ...apiJd, ...extractZhipinJdDom(doc), requirements: extractZhipinJdDom(doc)?.requirements || apiJd.requirements };
      }
    } catch {
      // API unavailable → DOM fallback below
    }
  }
  return extractZhipinJdDom(doc);
}

function toInput(jd: ZhipinJd): JdCaptureInput {
  return {
    source: 'zhipin',
    url: window.location.href,
    title: jd.title,
    company: jd.company,
    salaryText: jd.salaryText,
    requirements: jd.requirements,
    hrName: jd.hrName || undefined,
  };
}

async function main(): Promise<void> {
  const jd = await extractZhipinJd(document);
  if (!jd) return; // not a job detail page (e.g. 404 / login wall)

  const ctx = { jd: toInput(jd) };
  await captureAndShow(ctx, `Boss直聘 · ${jd.title}`);
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
