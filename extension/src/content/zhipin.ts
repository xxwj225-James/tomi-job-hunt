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
import { captureAndShow, pickLongText, pickText, showPanel } from './shared.js';
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

// --- API rate limiting (Boss直聘 risk control, learned the hard way) ---
// Real users request job/detail.json ONCE per page view. Polling it every
// few seconds looks like a bot and triggers 账号异常访问行为 verification.
// Rules: DOM-only extraction while polling; at most one API fetch per
// 15 seconds; each JD's result is cached for the session.
let lastApiFetchAt = 0;
const API_MIN_INTERVAL_MS = 15_000;
const apiCache = new Map<string, ZhipinJd>();

export async function extractZhipinJd(doc: Document): Promise<ZhipinJd | null> {
  return extractZhipinJdGuarded(doc, false);
}

/** DOM-only extraction — zero network, safe to call on every poll tick. */
export function extractZhipinJdDomOnly(doc: Document): ZhipinJd | null {
  return extractZhipinJdDom(doc);
}

async function extractZhipinJdGuarded(doc: Document, allowApi: boolean): Promise<ZhipinJd | null> {
  const domJd = extractZhipinJdDom(doc);
  if (!allowApi || !domJd) return domJd;

  // Session cache first: the same JD never hits the API twice.
  const cacheKey = `${domJd.title}|${domJd.company}`;
  const cached = apiCache.get(cacheKey);
  if (cached) return cached;

  // Hard rate limit: at most one fetch per API_MIN_INTERVAL_MS.
  if (Date.now() - lastApiFetchAt < API_MIN_INTERVAL_MS) return domJd;

  const jid = jidFromUrl(doc.location?.href ?? '') ?? jidFromDom(doc);
  if (jid) {
    lastApiFetchAt = Date.now();
    try {
      const resp = await fetch(`${DETAIL_API}?jid=${jid}&lid=&securityId=`, { credentials: 'include' });
      if (resp.ok) {
        const apiJd = parseWapiDetail(await resp.json());
        const merged: ZhipinJd | null =
          apiJd && apiJd.requirements
            ? apiJd
            : apiJd
              ? { ...apiJd, ...domJd, requirements: domJd.requirements || apiJd.requirements }
              : domJd;
        if (merged) apiCache.set(cacheKey, merged);
        return merged;
      }
    } catch {
      // API unavailable → DOM fallback below
    }
  }
  return domJd;
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

/** Tries to locate a jid in the DOM when the URL carries none (SPA detail). */
function jidFromDom(doc: Document): string | null {
  for (const attr of ['data-jid', 'data-jobid', 'data-job-id']) {
    for (const el of doc.querySelectorAll(`[${attr}]`)) {
      const value = el.getAttribute(attr);
      if (value && /^\d+$/.test(value)) return value;
    }
  }
  const link = doc.querySelector('a[href*="job_detail"]');
  const match = link?.getAttribute('href')?.match(/job_detail\/([^/.?#]+)/);
  return match?.[1] ?? null;
}

/**
 * True when the page shows an OPENED job-detail view (not just list items):
 * the detail container or the 立即沟通 button. Guards the SPA watcher on
 * list/home/company pages so a list entry is never mistaken for a detail.
 */
export function hasDetailMarker(doc: Document): boolean {
  return Boolean(
    doc.querySelector(
      '.job-detail-box, .job-detail-section, .job-detail, a.op-btn.op-btn-chat, .op-btn-chat',
    ),
  );
}

async function main(): Promise<void> {
  const isDetailUrl = /job_detail\//.test(window.location.href);

  if (isDetailUrl) {
    const jd = await extractZhipinJd(document);
    if (!jd) return; // 404 / login wall
    const ctx = { jd: toInput(jd) };
    await captureAndShow(ctx, `Boss直聘 · ${jd.title}`);
    return;
  }

  // SPA surfaces (导航职位列表 /web/geek/jobs、首页直开的 JD、公司招聘页
  // gongsi/job/*): a JD detail opens in the same page WITHOUT a URL change.
  // SAFEST DESIGN: the DOM watch is zero-network — it only detects the
  // opened detail and offers a 分析此岗位 button. The API fetch happens
  // ONLY when the user clicks (one request per JD, rate-limited + cached).
  let activeKey: string | null = null;
  const poll = async (): Promise<void> => {
    if (!hasDetailMarker(document)) return; // no detail open (list / home)
    const domJd = extractZhipinJdDomOnly(document);
    if (!domJd) return;
    const key = `${domJd.title}|${domJd.company}`;
    if (key === activeKey) return; // same JD still on screen — nothing to do
    activeKey = key;
    const ctx = { jd: toInput(domJd) };
    showPanel({
      title: 'TomiHunt',
      rows: [`检测到岗位：${domJd.title} @ ${domJd.company}`, domJd.salaryText ? `薪资：${domJd.salaryText}` : ''],
      actions: [
        {
          label: '🤖 分析此岗位',
          onClick: () => {
            void (async () => {
              const jd = await extractZhipinJdGuarded(document, true);
              ctx.jd = toInput(jd);
              await captureAndShow(ctx, `Boss直聘 · ${jd.title}`);
            })();
          },
          primary: true,
        },
      ],
    });
  };
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    if (ticks > 200) clearInterval(timer); // ~10 min lifetime
    void poll();
  }, 3000);
  void poll();
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
