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
import {
  CHAT_INPUT_SELECTORS,
  captureAndShow,
  clickOpenChatButton,
  enterAgentMode,
  fillChatBox,
  highlightChatInput,
  pickLongText,
  pickText,
  showPanel,
  watchChatForReplies,
} from './shared.js';
import type { JdCaptureInput } from '../types.js';
import { computeJobUid, reportSession } from './agent-client.js';

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
  // The job's own recruiter card. Verified live 2026-09-07 against
  // /a/77819271.shtml (陆女士) and /a/79453241.shtml (王先生): the name sits in
  // `section.recruiter-container` (inside <main>) as span.name within a
  // .name-box. Scope STRICTLY to that container — a page-wide `.recruiter-name`
  // / `.head-hunter-name` also matches the sidebar related-jobs (.job-list)
  // cards and the IM contact list, which used to capture a DIFFERENT
  // recruiter's name (e.g. stored 柯女士 / 潘女士 while the card showed the
  // real contact 王先生 / 陆女士).
  const hrName =
    pickText(doc, [
      '.recruiter-container .name-box .name',
      '.recruiter-container .name',
      '.recruiter-container .recruiter-name',
      '.job-recruiter .name',
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

// --- Desktop Agent (headless tab-control): make this JD's chat reachable ---
// Liepin chat has no separate route — it is an in-page overlay opened by the
// 聊一聊 button on the job detail page (the address bar stays on /a/<id>.shtml).
// Unlike zhipin (dedicated /web/geek/chat page with zhipin-chat.ts), there is
// no chat-page content script to register a session, so we register here once
// the JD identity is known. A session means "this JD's page tab is live"; on a
// dispatch we open the chat overlay if needed and fill + highlight — the user
// always presses send (compliance, same delivery as zhipin-chat).
//
// Dispatch protocol (extension/src/content/agent-client.ts):
//   SW → content:  tomihunt-dispatch {requestId,targetId,text}
//   content → SW:  tomi-ack {requestId,ok,error?,domSnippet?}

function sameOriginFrameDocs(): Document[] {
  const docs: Document[] = [];
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try {
      // Same-origin only — cross-origin access throws and is skipped.
      const inner = frame.contentDocument;
      if (inner) docs.push(inner);
    } catch {
      /* cross-origin frame — cannot fill inside */
    }
  }
  return docs;
}

/** Recruiter-name token as the site renders it (王先生 / 柯女士 / HR老师). */
const RECRUITER_NAME_RE = /^[一-龥·]{1,6}(?:女士|先生|老师)$/;

/** Topmost ancestor of the chat input that still belongs to the chat overlay
 *  (hints: fixed/absolute layer or im-/chat-/dialog class family). The name
 *  header sits inside this layer, so scanning it can't leak a recruiter card
 *  that lives elsewhere on the detail page. Falls back to the input's parent. */
function chatPanelRoot(input: Element, doc: Document): Element {
  let out: Element | null = null;
  let node: Element | null = input.parentElement;
  while (node && node !== doc.body) {
    const cls = typeof node.className === 'string' ? node.className : '';
    const pos = getComputedStyle(node).position;
    if (
      pos === 'fixed' ||
      pos === 'absolute' ||
      /(^|[\s_-])(im-chat|chat-(panel|window|wrap|box|container|main|dialog)|im-dialog|im-window|dialog|conversation|message-panel)([\s_-]|$)/i.test(
        cls,
      )
    ) {
      out = node;
    }
    node = node.parentElement;
  }
  return out ?? input.parentElement ?? input;
}

/** True when the element or an ancestor is hidden by inline styles. */
function isInlineHidden(el: Element): boolean {
  for (let n: Element | null = el; n && n.nodeType === 1; n = n.parentElement) {
    const s = (n as HTMLElement).style;
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true;
  }
  return false;
}

/**
 * Reads the CURRENT chat counterpart (the person this chat actually talks to)
 * from the open liepin overlay — the captured hrName can lag behind because a
 * posting may rotate which recruiter a view is matched with, so the page at
 * fill time is the source of truth. Scoped to the overlay's panel so a
 * different recruiter's name in the detail-page DOM never leaks in. Returns
 * undefined when no clean name token is found (caller keeps the stored name).
 */
export function readChatCounterpart(doc: Document = document): string | undefined {
  const input = doc.querySelector<HTMLElement>(CHAT_INPUT_SELECTORS.join(','));
  if (!input) return undefined;
  const root = chatPanelRoot(input, doc);
  for (const el of root.querySelectorAll<HTMLElement>('div, span, a, p, li, h1, h2, h3, strong, em')) {
    if (el === input || input.contains(el) || el.contains(input)) continue;
    if (isInlineHidden(el)) continue;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 12) continue;
    if (!RECRUITER_NAME_RE.test(text)) continue;
    return text; // first bare-name leaf in document order = the overlay header
  }
  return undefined;
}

function readLiveRecruiter(): string | undefined {
  for (const doc of [document, ...sameOriginFrameDocs()]) {
    const name = readChatCounterpart(doc);
    if (name) return name;
  }
  return undefined;
}

/**
 * Fills the chat input of the liepin overlay if reachable. Order: top-level
 * document → same-origin iframe (the overlay may render inside one) → open the
 * chat via 聊一聊 then retry. Fills + highlights only, never auto-sends.
 * On success also reads the live counterpart from the open overlay so the
 * desktop App can show the real person instead of a stale captured name.
 */
export async function fillLiepinChat(
  text: string,
): Promise<{ ok: boolean; error?: string; domSnippet?: string; recruiter?: string }> {
  const tryDocs = async (): Promise<boolean> => {
    for (const doc of [document, ...sameOriginFrameDocs()]) {
      if (fillChatBox(text, CHAT_INPUT_SELECTORS, doc)) return true;
    }
    return false;
  };

  if (await tryDocs()) {
    highlightChatInput();
    return { ok: true, domSnippet: '已填入聊天框并高亮，请确认后在页面发送', recruiter: readLiveRecruiter() };
  }

  if (!clickOpenChatButton()) {
    return { ok: false, error: '未找到聊天输入框，页面上也没有「聊一聊 / 沟通」按钮' };
  }

  // The chat overlay opens async — poll for the input like fillPitch does.
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 800));
    if (await tryDocs()) {
      highlightChatInput();
      return { ok: true, domSnippet: '已打开聊天窗口并填入，请确认后在页面发送', recruiter: readLiveRecruiter() };
    }
  }
  return { ok: false, error: '已打开聊天窗口，但未找到聊天输入框' };
}

/** Desktop-Agent dispatch entry on liepin pages (mirrors installAgentClient). */
export function installLiepinAgentClient(): void {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return undefined;
    const d = msg as { type?: string; requestId?: unknown; text?: unknown };
    if (d.type !== 'tomihunt-dispatch' || typeof d.requestId !== 'string' || typeof d.text !== 'string') {
      return undefined;
    }
    // The desktop Agent is now driving this page — enter agent mode so the
    // in-page floating widget (import/tagging tick + tagged completion +
    // smart reply) never (re)appears over the chat overlay for the rest of
    // this page session. A one-shot hidePanel() was NOT enough: capture ticks
    // and tagging events land AFTER the dispatch and used to re-create the
    // panel. Captures keep going to core silently.
    enterAgentMode();
    void fillLiepinChat(d.text).then(({ ok, error, domSnippet, recruiter }) => {
      void chrome.runtime
        .sendMessage({
          type: 'tomi-ack',
          requestId: d.requestId,
          ok,
          ...(ok ? { domSnippet } : {}),
          ...(ok && recruiter ? { recruiter } : {}),
          ...(error ? { error } : {}),
        })
        .catch(() => undefined);
    });
    return undefined;
  });
}

/**
 * Registers a gateway session for the JD on this page and keeps it in sync:
 * re-upsert when the background SW wakes (tomi-session-sync), remove on leave.
 * targetId = `jd:<uid>` where uid = sha256(trim(company)|trim(title)) — the same
 * uid core computes for the captured record, so the desktop Agent links them.
 */
export async function registerChatSession(jd: LiepinJd): Promise<void> {
  installLiepinAgentClient();
  const targetId = `jd:${await computeJobUid(jd.company, jd.title)}`;
  void reportSession('upsert', targetId);
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'tomi-session-sync') {
      void reportSession('upsert', targetId);
    }
    return undefined;
  });
  window.addEventListener('pagehide', () => void reportSession('remove', targetId), { once: true });
}

async function main(): Promise<void> {
  // HR 端页面（猎聘 HR 端候选人简历页）由 hr-liepin 处理，求职者分析不应触发。
  // TODO(platform): 待真实 HR 端 URL 确定后填入路径片段，当前空列表无行为影响。
  const HR_PATHS: string[] = [];
  if (HR_PATHS.some((p) => window.location.href.includes(p))) return;
  // Smart replies work in liepin's in-page chat panel too.
  watchChatForReplies();
  const jd = await waitForJd(document);
  if (!jd) return;

  // Make this JD's page tab reachable by the desktop Agent (session + fill).
  await registerChatSession(jd);

  const ctx = { jd: toInput(jd) };
  captureAndShow(ctx, `猎聘 · ${jd.title}`).catch(() => {
    showPanel({ state: 'error', title: `猎聘 · ${jd.title}`, rows: [], error: '导入失败，请查看控制台' });
  });
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
