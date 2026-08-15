/**
 * 猎聘 job detail page (liepin.com/job/*): JD extraction only.
 * No chat box on Liepin, so the panel offers import + tags + copy-to-clipboard
 * (greeting generation is Boss直聘-specific per Phase 1 scope).
 */
import { captureAndShow, pickLongText, pickText, showPanel } from './shared.js';
import type { JdCaptureInput } from '../types.js';

export interface LiepinJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName: string;
}

export function extractLiepinJd(doc: Document): LiepinJd | null {
  const title = pickText(doc, ['.title-info h1', '.job-title h1', '.title h1', 'h1']) || '';
  const company =
    pickText(doc, [
      '.company-info .name',
      '.job-company-name',
      '.company-name',
      '.company-logo h1',
    ]) || '';
  if (!title || !company) return null;

  const salaryText =
    pickText(doc, ['.job-item-title', '.salary', '.job-main-title .job-item-title']) || '';
  const requirements =
    pickLongText(doc, [
      '.job-description',
      '.content-word',
      '.job-detail .content',
      '.dd.noborder',
    ]) || '';
  const hrName =
    pickText(doc, ['.recruiter-name', '.job-recruiter .name', '.head-hunter-name']) || '';

  return { title, company, salaryText, requirements, hrName };
}

function toInput(jd: LiepinJd): JdCaptureInput {
  return {
    source: 'liepin',
    url: window.location.href,
    title: jd.title,
    company: jd.company,
    salaryText: jd.salaryText,
    requirements: jd.requirements,
    hrName: jd.hrName || undefined,
  };
}

/**
 * Liepin detail body is AJAX-injected after the SSR shell loads (verified
 * live, 2026-08) — poll until the detail selectors resolve.
 */
export async function waitForJd(
  doc: Document,
  timeoutMs = 8000,
  intervalMs = 300,
): Promise<LiepinJd | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const jd = extractLiepinJd(doc);
    if (jd) return jd;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

async function main(): Promise<void> {
  const jd = await waitForJd(document);
  if (!jd) return;

  const ctx = { jd: toInput(jd) };
  captureAndShow(ctx, `猎聘 · ${jd.title}`).catch(() => {
    showPanel({ state: 'error', title: `猎聘 · ${jd.title}`, rows: [], error: '导入失败，请查看控制台' });
  });
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
