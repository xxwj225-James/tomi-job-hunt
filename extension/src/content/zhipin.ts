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
import {
  captureAndShow,
  client,
  enterJobView,
  generatePitch,
  pickLongText,
  pickLongTextEl,
  pickText,
  saveLastJd,
  showMatch,
  showPanel,
} from './shared.js';
import { isChallengePage, showChallengePanel } from './challenge.js';
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

/**
 * Containers holding the VIEWED job's own header + body, narrowest first.
 *
 * Every field must be resolved inside one of these. A document-wide lookup
 * mixed fields from DIFFERENT jobs on the same page: BOSS surrounds the JD
 * with recommendation/similar-job cards, and those cards use the very same
 * class names we read (`.job-name`, `.company-name` — see zhipin-list.ts).
 * That is how one 近硕半导体 JD ended up stored under four different
 * companies, one of them a card's own truncated label ("…人工...").
 */
const DETAIL_CONTAINERS = [
  '.job-detail-box',
  '.job-detail-container',
  '.job-detail-wrapper',
  '.job-detail-section',
];

/** Field candidates, in priority order (markup drifts between layouts). */
const TITLE_SEL = ['.job-detail-header .job-name', '.job-title', '.job-name h1', '.name h1', 'h1'];
const COMPANY_SEL = [
  '.job-detail-header .job-company-name',
  '.job-detail-header .company-name',
  '.job-detail-header .name',
  '.company-text',
  '.company-info .name',
  '.job-company .name',
  // Card selectors (and `.boss-name`, an HR *person* on cards) stay last: they
  // are what leaked a stranger's company into a record.
  '.company-name',
  '.boss-name',
];
const SALARY_SEL = ['.job-detail-header .job-salary', '.job-salary', '.salary', '.job-title-box .salary'];
const JD_BODY_SEL = [
  '.job-detail .job-keyword-list + .job-sec-text',
  '.job-detail-section .job-sec-text',
  '.job-sec-text',
  '.job-description',
  '.job-detail .text',
  '.job-sec .text',
];
const HR_SEL = ['.job-boss-info h2.name', '.job-boss .name', '.boss-info .name', '.recruiter-name'];

/** Presence-only (no text extraction) — detailScope() runs on every poll tick. */
const holds = (el: Element, selectors: string[]): boolean => selectors.some((s) => el.querySelector(s));

/**
 * Container wrapping the shown job, or the whole document (legacy markup).
 *
 * Split views — BOSS's 一览 page, list on the left and the opened JD on the
 * right — carry no container class we can rely on. There the body element
 * anchors the scope instead: the smallest ancestor holding both the long JD
 * text and a header IS the detail pane, and the list cards sit outside it.
 * Without this every card on the page shares one scope and the library only
 * ever receives the first card of the list.
 */
export function detailScope(doc: Document): ParentNode {
  for (const sel of DETAIL_CONTAINERS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  const body = pickLongTextEl(doc, JD_BODY_SEL);
  for (let el = body?.parentElement ?? null; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
    if (holds(el, TITLE_SEL) && holds(el, COMPANY_SEL)) return el;
  }
  return doc;
}

/** Reads every field from ONE root, so they are all the same job's. */
function readJd(root: ParentNode): ZhipinJd {
  const title = pickText(root, TITLE_SEL) || '';
  const company = pickText(root, COMPANY_SEL) || '';
  const salaryText = pickText(root, SALARY_SEL) || '';
  const requirements = pickLongText(root, JD_BODY_SEL) || '';
  const hrName = pickText(root, HR_SEL) || '';
  return { title, company, salaryText, requirements, hrName };
}

/** List-card containers — same classes zhipin-list.ts badges. */
const LIST_CARD_SEL = '.job-card-wrapper, .job-list-box li, .job-card-body';

/** DOM fallback extraction with current + legacy selector candidates. */
export function extractZhipinJdDom(doc: Document): ZhipinJd | null {
  const scope = detailScope(doc);
  if (scope !== doc) {
    const scoped = readJd(scope);
    if (scoped.title && scoped.company) return scoped;
    // Container found but no header inside it (layout drift) → legacy lookup.
  }
  // No job is actually opened: the only long text on the page is a list card's
  // own snippet (click-through in flight). Filing that would store a card
  // summary as a JD, so report "nothing here" and let the next tick retry.
  if (pickLongTextEl(doc, JD_BODY_SEL)?.closest(LIST_CARD_SEL)) return null;
  const legacy = readJd(doc);
  return legacy.title && legacy.company ? legacy : null;
}

// --- API rate limiting (Boss直聘 risk control, learned the hard way) ---
// Real users request job/detail.json ONCE per page view. Polling it every
// few seconds looks like a bot and triggers 账号异常访问行为 verification.
// Rules: DOM-only extraction while polling; at most one API fetch per
// 15 seconds; each JD's result is cached for the session; and if the API
// ever answers with a risk-control challenge (no jobDetail payload), the
// API path is DISABLED for the whole session — DOM-only from then on.
let lastApiFetchAt = 0;
const API_MIN_INTERVAL_MS = 15_000;
const apiCache = new Map<string, ZhipinJd>();
let apiDisabledForSession = false;

/**
 * Cross-tab gate for the ONE endpoint we ever call on BOSS.
 *
 * `lastApiFetchAt` above is per content-script instance, so N open BOSS tabs
 * meant N independent 15s windows — the busiest case (many tabs) had the
 * loosest limit. The service worker owns a single clock instead, shared by
 * every tab and remembered across SW idle-sleeps; this tab asks for a slot and
 * goes DOM-only when it is not this tab's turn.
 */
async function requestApiSlot(): Promise<boolean> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'tomi-api-slot' })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    // SW unreachable / extension context tearing down → keep the in-tab limit.
    return Date.now() - lastApiFetchAt >= API_MIN_INTERVAL_MS;
  }
}

/** True when the response looks like a risk-control challenge, not job data. */
function looksLikeRiskChallenge(json: unknown): boolean {
  const root = json as { zpData?: unknown; code?: number; message?: string };
  if (root.code !== undefined && root.code !== 0) return true;
  if (!root.zpData) return true; // normal detail responses carry zpData
  const detail = (root.zpData as { jobDetail?: unknown }).jobDetail;
  return detail === undefined || detail === null;
}

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

  // Hard rate limit: at most one fetch per API_MIN_INTERVAL_MS in this tab, and
  // at most one per global slot across all tabs (requestApiSlot).
  if (Date.now() - lastApiFetchAt < API_MIN_INTERVAL_MS) return domJd;
  if (apiDisabledForSession) return domJd; // challenged earlier — DOM only
  if (!(await requestApiSlot())) return domJd;
  const jid = jidFromUrl(doc.location?.href ?? '') ?? jidFromDom(doc);
  if (jid) {
    lastApiFetchAt = Date.now();
    try {
      const resp = await fetch(`${DETAIL_API}?jid=${jid}&lid=&securityId=`, { credentials: 'include' });
      if (resp.ok) {
        const json = await resp.json();
        if (looksLikeRiskChallenge(json)) {
          // The account is being challenged — stop using the API entirely
          // for this session and fall back to the DOM. Never hammer a
          // challenged endpoint.
          apiDisabledForSession = true;
          return domJd;
        }
        const apiJd = parseWapiDetail(json);
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

/**
 * Tries to locate a jid in the DOM when the URL carries none (SPA detail).
 * Scoped to the shown job's container: the first `job_detail` link on a BOSS
 * page normally belongs to a recommendation card, and the jid is what the
 * guarded API fetch asks for — a card's jid would fetch and analyze a job the
 * user is not looking at. Document-wide only when there is no container.
 */
function jidFromDom(doc: Document): string | null {
  const root = detailScope(doc);
  for (const attr of ['data-jid', 'data-jobid', 'data-job-id']) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const value = el.getAttribute(attr);
      if (value && /^\d+$/.test(value)) return value;
    }
  }
  const link = root.querySelector('a[href*="job_detail"]');
  return link?.getAttribute('href')?.match(/job_detail\/([^/.?#]+)/)?.[1] ?? null;
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

/**
 * BOSS SPA watcher — keeps the floating panel pinned to the job CURRENTLY
 * viewed and silently deposits each viewed job into the local JD library.
 *
 * On list/home/company pages a JD detail opens in-page (no URL change). When a
 * NEW job is stably shown it:
 *   1. bumps the shared view epoch (enterJobView) so any still-running analysis
 *      of an EARLIER job stops painting over this view — Core still finishes it
 *      in the background, so that job's 库 record gets its tags, no panel pops;
 *   2. silently imports the DOM-only JD into Core with tag:false → zero LLM;
 *   3. re-renders the floating panel for the new job.
 * Zero BOSS-network traffic here: extraction is DOM-only and the import goes to
 * the local Core service. The guarded wapi detail fetch happens only when the
 * user explicitly clicks 分析此岗位 (rate-limited + session-cached as before).
 * Every panel action re-extracts the job on screen AT CLICK TIME, so an action
 * can never analyze a job other than the one being viewed.
 */
export interface ZhipinSpaWatcherOptions {
  /** Poll cadence in ms (default 2000). */
  pollMs?: number;
  /** Injectable for tests — defaults to a silent tag:false Core capture. */
  silentImport?: (jd: ZhipinJd) => Promise<void>;
  /** Injectable for tests — defaults to the current-job floating panel. */
  renderPanel?: (jd: ZhipinJd) => void;
}

/** Default silent import: DOM-only JD → POST /v1/jd/capture with tag:false. */
async function defaultSilentImport(jd: ZhipinJd): Promise<void> {
  await client.captureJd(toInput(jd), { tag: false });
}

export function attachZhipinSpaWatcher(opts: ZhipinSpaWatcherOptions = {}): () => void {
  const pollMs = opts.pollMs ?? 2000;
  const silentImport = opts.silentImport ?? defaultSilentImport;

  // Keys already imported this content-script session (avoid re-POSTing).
  const imported = new Set<string>();
  // A job whose silent import has not succeeded yet (Core may have been off).
  let pendingImport: { key: string; jd: ZhipinJd; attempts: number } | null = null;
  // The currently adopted job — what the panel describes.
  let adoptedKey: string | null = null;
  // 2-consecutive-tick stability: transient SPA flicker / skeletons never commit.
  let candidateKey: string | null = null;
  let candidateStreak = 0;

  const extractLive = (): ZhipinJd | null => extractZhipinJdDomOnly(document);

  const keyOf = (jd: ZhipinJd): string => jidFromDom(document) ?? `${jd.title}|${jd.company}`;

  /** Silent, retry-while-on-screen import into the JD library (no LLM). */
  const attemptImport = async (): Promise<void> => {
    const p = pendingImport;
    if (!p) return;
    try {
      await silentImport(p.jd);
      imported.add(p.key);
      pendingImport = null;
    } catch {
      p.attempts += 1;
      if (p.attempts >= 3) pendingImport = null; // give up; revisiting the job retries
    }
  };

  const adopt = async (jd: ZhipinJd): Promise<void> => {
    const key = keyOf(jd);
    const isSame = key === adoptedKey;
    adoptedKey = key;
    // Remember the job on screen. 立即沟通 opens /web/geek/chat a moment later,
    // and that page has no way of telling WHICH job its chat box belongs to
    // unless the extension left a trace — it registers itself as the app's fill
    // target from here (shared.ts loadLastJd). captureAndShow does the same on
    // single-JD pages; this is the SPA path, where the app drives silently and
    // no panel ever shows.
    await saveLastJd(toInput(jd));
    if (!isSame) {
      // Supersede any in-flight analysis of the previously-viewed job: its
      // ticks/sockets are disposed and its completions never paint here.
      enterJobView();
    }
    if (!imported.has(key) && !(pendingImport && pendingImport.key === key)) {
      pendingImport = { key, jd, attempts: 0 };
      void attemptImport();
    }
    if (!isSame) (opts.renderPanel ?? defaultRender)(jd);
  };

  // Runs `task` against the job on screen AT CLICK TIME, adopting it first if
  // the user switched jobs since this panel was rendered — an action can never
  // score a job that is no longer being viewed.
  const runOnLive =
    (task: (live: ZhipinJd) => void | Promise<void>): (() => void) =>
    () => {
      void (async () => {
        const live = extractLive();
        if (!live) return;
        await adopt(live);
        await task(live);
      })();
    };

  const analyzeLive = async (live: ZhipinJd): Promise<void> => {
    // Guarded detail fetch (plaintext salary / clean JD; rate-limited, session-
    // cached, disabled after a risk-control challenge) — the ONLY Boss API call.
    const enriched = (await extractZhipinJdGuarded(document, true)) ?? live;
    await captureAndShow({ jd: toInput(enriched) }, `Boss直聘 · ${enriched.title}`);
  };

  const defaultRender = (jd: ZhipinJd): void => {
    showPanel({
      title: `TomiHunt · ${jd.title}`,
      rows: [
        `岗位：${jd.title} @ ${jd.company}`,
        jd.salaryText ? `薪资：${jd.salaryText}` : '',
        '已自动存入本地 JD 库。AI 分析只在点击时对当前岗位执行，不消耗额度。',
      ],
      actions: [
        { label: '🤖 分析此岗位', primary: true, onClick: runOnLive(analyzeLive) },
        {
          label: '匹配度打分',
          onClick: runOnLive((live) => showMatch({ jd: toInput(live) }, `Boss直聘 · ${live.title}`)),
        },
        {
          label: '生成打招呼语',
          onClick: runOnLive((live) => generatePitch({ jd: toInput(live) }, `Boss直聘 · ${live.title}`)),
        },
      ],
    });
  };

  const tick = async (): Promise<void> => {
    // A verification wall is not a job: stop importing (its text would land in
    // the JD library as a "job"), stop the API path for this session, and tell
    // the user once. Checked ahead of the detail marker — the wall can cover a
    // page whose marker is still in the DOM behind it.
    if (isChallengePage(document)) {
      candidateKey = null;
      candidateStreak = 0;
      apiDisabledForSession = true;
      showChallengePanel();
      return;
    }
    if (!hasDetailMarker(document)) {
      // no detail open (list / home / company landing) — forget a half-seen job
      candidateKey = null;
      candidateStreak = 0;
      return;
    }
    const jd = extractLive();
    if (!jd) return;
    const key = keyOf(jd);
    if (key === candidateKey) {
      candidateStreak += 1;
    } else {
      candidateKey = key;
      candidateStreak = 1;
    }
    if (candidateStreak < 2) return; // not shown stably yet
    if (key === adoptedKey) {
      void attemptImport(); // Core may be back up — finish a pending import
      return;
    }
    await adopt(jd);
  };

  const timer = setInterval(() => void tick(), pollMs);
  void tick();
  return () => clearInterval(timer);
}

async function main(): Promise<void> {
  // HR 端页面（Boss直聘 HR 端候选人简历页）由 hr-zhipin 处理，求职者分析不应触发。
  // TODO(platform): 待真实 HR 端 URL 确定后填入路径片段（如 '/web/boss/'），当前空列表无行为影响。
  const HR_PATHS: string[] = [];
  if (HR_PATHS.some((p) => window.location.href.includes(p))) return;

  // Risk-control wall: this document is BOSS's verification page, not a job.
  // Extracting it would deposit a fake JD and the API path must stay shut.
  if (isChallengePage(document)) {
    apiDisabledForSession = true;
    showChallengePanel();
    return;
  }

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
  // The controller (DOM-only + zero BOSS-network) auto-imports each newly
  // viewed job into the local JD 库 with tag:false, pins the floating panel to
  // the CURRENT job, and runs LLM only when the user clicks an action. The
  // guarded wapi detail fetch still happens only on an explicit 分析 click.
  attachZhipinSpaWatcher();
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
