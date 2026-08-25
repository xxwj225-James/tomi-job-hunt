/**
 * 猎聘 job detail page — JD extraction only.
 * No chat box on Liepin, so the panel offers import + tags + copy-to-clipboard
 * (greeting generation is Boss直聘-specific per Phase 1 scope).
 *
 * Extraction strategy (verified against a LIVE page, 2026-08-17,
 * https://www.liepin.com/a/79090643.shtml — the current /a/<id>.shtml build):
 *   1. `window.$CONFIG` (inline JSON): jobTitle + compName — stable, appears
 *      on the current build.  Guarded because it's an inline script, not DOM.
 *   2. schema.org JobPosting JSON-LD: full JD body in `description` — best
 *      for the long-form requirements (regex-extracted, tolerant of control
 *      chars in real pages).
 *   3. DOM fallback: current selectors (.job-apply-content .name-box .name,
 *      .job-intro-container, .recruiter-container …) plus the legacy
 *      selectors from the pre-2026 build, so older pages still work.
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

/**
 * Extracts jobTitle + compName from the inline `var $CONFIG = {...};` JSON
 * that the current liepin build embeds (used for SEO/chat widgets).
 *
 * The object may contain nested values (e.g. traceId: {…}), so a naive
 * `\{.*?\}` match would stop at the first inner `}`. We instead locate the
 * assignment with brace-balancing, then JSON.parse the captured slice.
 */
export function parseConfig(doc: Document): { jobTitle?: string; compName?: string } {
  for (const el of doc.querySelectorAll('script')) {
    const text = el.textContent ?? '';
    const start = text.indexOf('var $CONFIG =');
    if (start < 0) continue;
    // Find the object's closing brace with a depth counter.
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start + 'var $CONFIG ='.length; i < text.length; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) continue;
    try {
      const cfg: Record<string, unknown> = JSON.parse(text.slice(start + 'var $CONFIG ='.length, end + 1));
      const jobTitle = typeof cfg.jobTitle === 'string' ? cfg.jobTitle : undefined;
      const compName = typeof cfg.compName === 'string' ? cfg.compName : undefined;
      if (jobTitle || compName) return { jobTitle, compName };
    } catch {
      // not JSON (or truncated) — skip, DOM fallback below
    }
  }
  return {};
}

/**
 * Extracts {title, description} from the schema.org JobPosting JSON-LD.
 * Real pages embed control chars inside string literals, so we clean them
 * before JSON.parse and fall back to regex on failure.
 */
export function parseJobPosting(doc: Document): { title?: string; description?: string } {
  for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = el.textContent ?? '';
    if (!raw.includes('JobPosting')) continue;
    const cleaned = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
    try {
      const json: Record<string, unknown> = JSON.parse(cleaned);
      return {
        title: typeof json.title === 'string' ? json.title : undefined,
        description: typeof json.description === 'string' ? json.description : undefined,
      };
    } catch {
      const title = raw.match(/"title"\s*:\s*"([^"]+)"/)?.[1];
      const description = raw.match(/"description"\s*:\s*"([\s\S]*?)"\s*,/)?.[1];
      if (title || description) return { title, description };
    }
  }
  return {};
}

/** DOM fallback extraction: current (2026) + legacy selector candidates. */
export function extractLiepinJdDom(doc: Document): LiepinJd | null {
  const title =
    pickText(doc, [
      '.job-apply-content .name-box .name',
      '.job-apply-content .name',
      '.title-info h1',
      '.job-title h1',
      '.title h1',
      'h1',
    ]) || '';
  const company =
    pickText(doc, [
      '.job-apply-container .company-name',
      '.job-apply-content .company-name',
      '.company-info .name',
      '.job-company-name',
      '.company-name',
      '.company-logo h1',
    ]) || '';
  if (!title || !company) return null;

  const salaryText =
    pickText(doc, [
      '.job-apply-content .salary',
      '.job-apply-content .job-item-title',
      '.job-item-title',
      '.salary',
      '.job-main-title .job-item-title',
    ]) || '';
  const requirements =
    pickLongText(doc, [
      '.job-intro-container',
      '.job-apply-content .job-description',
      '.job-description',
      '.content-word',
      '.job-detail .content',
      '.dd.noborder',
    ]) || '';
  const hrName =
    pickText(doc, [
      '.recruiter-container .recruiter-name',
      '.recruiter-name',
      '.job-recruiter .name',
      '.head-hunter-name',
    ]) || '';

  return { title, company, salaryText, requirements, hrName };
}

/** Best-effort merge: JSON sources first, DOM fallback fills the gaps. */
export function extractLiepinJd(doc: Document): LiepinJd | null {
  const cfg = parseConfig(doc);
  const jp = parseJobPosting(doc);
  const dom = extractLiepinJdDom(doc);

  const title = cfg.jobTitle || jp.title || dom?.title || '';
  const company = cfg.compName || dom?.company || '';
  if (!title || !company) return null;

  const requirements = jp.description || dom?.requirements || '';
  if (!requirements) return null;

  return {
    title,
    company,
    salaryText: dom?.salaryText || '',
    requirements,
    hrName: dom?.hrName || '',
  };
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
