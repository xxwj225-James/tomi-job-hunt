/**
 * Shared helpers for content scripts: resilient text extraction, an isolated
 * floating panel (shadow DOM), chat-box filling, and Core wiring.
 *
 * Anti-obfuscation notes (verified via live research, 2026-08):
 * - zhipin injects CSS-hidden interference words into JD/HR text — strip them
 * - the chat box is a contenteditable div (NOT a textarea) on /web/geek/chat
 */
import { CoreClient, CORE_BASE, formatTags, getCoreBase } from '../core-client.js';
import { backendGreeting, backendInterview, backendMatch, backendReply, backendTag, detectBackend } from './backend.js';
import type { JdCaptureInput, JdTags, GreetingResult } from '../types.js';

export const client = new CoreClient();

/** Support/donation page (affiliate links) — footer of every panel state. */
const SUPPORT_URL = 'https://github.com/xxwj225-James/tomi-job-hunt/blob/main/docs/support.md';
/** Author's other product — subtle referral next to the support link. */
const TOMILITE_URL = 'https://github.com/xxwj225-James/tomilite';

/**
 * Removes elements hidden by CSS from a detached clone, so textContent stays
 * clean of interference words (display:none / visibility:hidden / width:0).
 */
export function stripHidden(node: Element): Element {
  const clone = node.cloneNode(true) as Element;
  // 1) Inline-hidden elements
  for (const el of clone.querySelectorAll<HTMLElement>('*')) {
    const style = el.style;
    if (style.display === 'none' || style.visibility === 'hidden' || style.width === '0px' || style.height === '0px') {
      el.remove();
    }
  }
  // 2) Rule-hidden: scan stylesheets for display/visibility rules, remove matches
  try {
    const hideSelectors: string[] = [];
    for (const sheet of node.ownerDocument.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          const text = rule.style.cssText;
          if (/\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b|\bwidth\s*:\s*0(px)?\b/.test(text)) {
            hideSelectors.push(rule.selectorText);
          }
        }
      }
    }
    if (hideSelectors.length > 0) {
      for (const el of clone.querySelectorAll(hideSelectors.join(','))) el.remove();
    }
  } catch {
    // stylesheet scanning is best-effort
  }
  return clone;
}

/** First non-empty cleaned text across candidate selectors (site markup drifts). */
export function pickText(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const text = stripHidden(el).textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/** Picks the longest cleaned text among candidates — JD sections are long-form. */
export function pickLongText(doc: Document, selectors: string[]): string {
  let best = '';
  for (const sel of selectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const text = stripHidden(el).textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > best.length) best = text;
    }
  }
  return best;
}

/**
 * Fills the zhipin chat box. Real-world (2026): it is a contenteditable div,
 * not a textarea — set textContent, put the caret at the end, dispatch
 * beforeinput/input so React state syncs. Textarea fallback kept for edge
 * layouts and the native-setter trick for React-controlled textareas.
 */
export function fillChatBox(text: string, selectors: string[]): boolean {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // contenteditable div
      el.textContent = text;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    el.focus();
    return true;
  }
  return false;
}

// --- Incoming HR message observation (smart reply trigger) ---

// Candidate selectors for chat message items (both sites' markup drifts).
const MSG_SELECTORS = [
  '.chat-record .message',
  '[class*="chat-message"]',
  '[class*="message-item"]',
  '.im-message-item',
  '.msg-item',
  '[class*="msg-content"]',
];

/** Heuristic side classification: right/self-marked = mine, else theirs. */
function isMyMessage(el: Element): boolean {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(^|[ _-])(self|right|mine|me)([ _-]|$)/i.test(cls)) return true;
  if (/(^|[ _-])(left|from|other)([ _-]|$)/i.test(cls)) return false;
  const style = (el as HTMLElement).style;
  if (style.cssFloat === 'right' || style.textAlign === 'right') return true;
  return false;
}

/**
 * Watches the chat area for NEW incoming messages (from the other side).
 * Dedupes by content; fires onIncoming(text) once per new message.
 * Returns a stop function.
 */
export function observeChatMessages(onIncoming: (text: string) => void): () => void {
  const seen = new Set<string>();
  const consider = (el: Element): void => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    if (seen.has(text)) return;
    if (isMyMessage(el)) return; // my own messages never trigger replies
    seen.add(text);
    onIncoming(text);
  };
  // Existing messages first (page load mid-conversation)
  for (const sel of MSG_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) consider(el);
  }
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const el = node.matches(MSG_SELECTORS.join(',')) ? node : node.querySelector(MSG_SELECTORS.join(','));
        if (el) consider(el);
        if (node.matches(MSG_SELECTORS.join(','))) consider(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// --- Smart reply: HR message → AI draft → fill (user sends) ---

const LAST_JD_KEY = 'tomihunt-last-jd';

// Auto-send governor: minimum 30s between sends, max 10 per page session.
// Bulk-message patterns are the classic account-ban trigger — never allow
// the extension to produce them.
let lastAutoSendAt = 0;
let autoSendCount = 0;
const AUTO_SEND_MIN_INTERVAL_MS = 30_000;
const AUTO_SEND_MAX_PER_SESSION = 10;

export async function saveLastJd(jd: JdCaptureInput): Promise<void> {
  try {
    await chrome.storage.session.set({ [LAST_JD_KEY]: jd });
  } catch {
    // session storage unavailable — reply falls back to generic context
  }
}

async function loadLastJd(): Promise<JdCaptureInput | null> {
  try {
    const data = await chrome.storage.session.get(LAST_JD_KEY);
    return (data[LAST_JD_KEY] as JdCaptureInput | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Rolling conversation history observed on this page (for reply context). */
const replyHistory: Array<{ speaker: 'hr' | 'me'; content: string }> = [];
let lastReplyAt = 0;
const REPLY_COOLDOWN_MS = 10_000;

async function smartReplyEnabled(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get('tomihunt-smart-reply');
    return data['tomihunt-smart-reply'] !== 'off';
  } catch {
    return true; // default on
  }
}

/**
 * Reacts to an incoming HR message: drafts a reply (JD + resume + recent
 * history) and fills it into the chat box — the user always sends it.
 */
export async function handleIncomingMessage(text: string): Promise<void> {
  if (!(await smartReplyEnabled())) return;
  const now = Date.now();
  if (now - lastReplyAt < REPLY_COOLDOWN_MS) return;
  lastReplyAt = now;

  replyHistory.push({ speaker: 'hr', content: text });
  const jd = await loadLastJd();
  const resume = await loadResumeFromExtension();
  try {
    const { reply } = await backendReply({
      jd: jd ?? { title: '未知岗位', company: '未知公司', salaryText: '', requirements: '' },
      resume: resume ?? undefined,
      history: replyHistory.slice(-8),
      incoming: text,
    });
    replyHistory.push({ speaker: 'me', content: reply });
    const filled = fillChatBox(reply, CHAT_INPUT_SELECTORS);
    showPanel({
      title: 'TomiHunt · 智能回复',
      rows: filled
        ? ['已根据对方消息拟好回复并填入聊天框', '确认内容后自行点击发送。']
        : ['已拟好回复，但未找到聊天输入框（请先打开聊天窗口）：'],
      pitch: reply,
    });
  } catch {
    // generation failure — stay silent, the user can reply manually
  }
}

/** Wires the observer on chat-capable pages. */
export function watchChatForReplies(): void {
  observeChatMessages((text) => {
    void handleIncomingMessage(text);
  });
}

// --- Pitch handoff between job detail page and the SPA chat page ---
// 立即沟通 navigates to /web/geek/chat/* — a different route with a different
// content script. The generated pitch travels via chrome.storage.session.

export interface StoredPitch {
  pitch: string;
  jdTitle: string;
  ts: number;
}

export async function savePitch(pitch: StoredPitch): Promise<void> {
  try {
    await chrome.storage.session.set({ 'tomihunt-pitch': pitch });
  } catch {
    // storage unavailable — pitch stays on the current page only
  }
}

async function loadResumeFromExtension(): Promise<string | undefined> {
  try {
    const data = await chrome.storage.local.get('tomihunt-resume');
    return (data['tomihunt-resume'] as string | undefined)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function loadPitch(): Promise<StoredPitch | null> {
  try {
    const data = await chrome.storage.session.get('tomihunt-pitch');
    return (data['tomihunt-pitch'] as StoredPitch | undefined) ?? null;
  } catch {
    return null;
  }
}

// --- Floating panel (shadow-DOM isolated) ---

type PanelState = 'idle' | 'tagging' | 'error';

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;

const PANEL_CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; font-family: system-ui, "Microsoft YaHei", sans-serif; }
.btn { display: inline-block; padding: 10px 16px; border-radius: 20px; border: 0; cursor: pointer;
  font-size: 14px; font-weight: 600; color: #fff; background: linear-gradient(135deg, #4f7cff, #6a5cff);
  box-shadow: 0 4px 14px rgba(80, 90, 220, .35); }
.btn:disabled { opacity: .5; cursor: default; }
.btn.secondary { background: #f0f2f7; color: #333; box-shadow: none; margin-left: 8px; }
.panel { margin-top: 10px; width: 300px; max-height: 420px; overflow-y: auto; background: #fff; color: #222;
  border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18); padding: 14px; font-size: 13px; line-height: 1.6; display: none; }
.panel.open { display: block; }
.h { font-weight: 700; margin-bottom: 6px; }
.row { margin-bottom: 6px; }
.tags { background: #f6f8ff; border-radius: 8px; padding: 8px; margin: 8px 0; }
.warn { color: #b25e00; }
.err { color: #c0392b; }
.pitch { background: #f0fdf4; border-radius: 8px; padding: 10px; margin: 8px 0; white-space: pre-wrap; }
.spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #ccc; border-top-color: #4f7cff; border-radius: 50%; animation: spin 1s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes spin { to { transform: rotate(360deg); } }
.support { margin-top: 10px; padding-top: 8px; border-top: 1px solid #f0f0f0; font-size: 11px; color: #999; }
.support a { color: #4f7cff; text-decoration: none; }
`;

function ensurePanel(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement('div');
  host.id = 'tomihunt-panel-host';
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.append(style);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button class="btn" id="tomi-toggle">🤖 TomiHunt</button>
    <div class="panel" id="tomi-panel"></div>`;
  shadow.append(wrap);
  (document.body ?? document.documentElement).append(host);
  return shadow;
}

function panelEl(): HTMLElement {
  const s = ensurePanel();
  return s.querySelector('#tomi-panel') as HTMLElement;
}

function setPanelHtml(html: string, open = true): void {
  const s = ensurePanel();
  const panel = s.querySelector('#tomi-panel') as HTMLElement;
  panel.innerHTML = html;
  panel.classList.toggle('open', open);
}

function wireToggle(): void {
  const s = ensurePanel();
  const btn = s.querySelector('#tomi-toggle') as HTMLButtonElement;
  const panel = s.querySelector('#tomi-panel') as HTMLElement;
  btn.onclick = () => panel.classList.toggle('open');
}

/** Renders a state into the panel; callbacks re-render after async steps. */
export function showPanel(content: {
  state?: PanelState;
  title: string;
  rows: string[];
  tags?: JdTags | null;
  pitch?: string;
  error?: string;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>;
  /** Optional feedback textarea (e.g. regeneration opinions). */
  input?: { placeholder?: string; value?: string };
  onInput?: (value: string) => void;
}): void {
  const rows = content.rows.map((r) => `<div class="row">${escapeHtml(r)}</div>`).join('');
  const tagsHtml = content.tags
    ? `<div class="tags">${escapeHtml(formatTags(content.tags))}</div>`
    : '';
  const pitchHtml = content.pitch ? `<div class="pitch">${escapeHtml(content.pitch)}</div>` : '';
  const spinner = content.state === 'tagging' ? '<span class="spinner"></span>' : '';
  const errorHtml = content.error ? `<div class="err">${escapeHtml(content.error)}</div>` : '';
  const inputHtml = content.input
    ? `<textarea class="feedback" rows="3" placeholder="${escapeHtml(content.input.placeholder ?? '')}" style="width:100%;box-sizing:border-box;margin:8px 0;padding:8px;border:1px solid #d0d5dd;border-radius:8px;font:inherit">${escapeHtml(content.input.value ?? '')}</textarea>`
    : '';
  const actionsHtml =
    content.actions
      ?.map(
        (a) =>
          `<button class="btn ${a.primary === false ? 'secondary' : ''}" data-action="${a.label}">${escapeHtml(a.label)}</button>`,
      )
      .join('') ?? '';
  // Support footer appears on EVERY panel state (tags / match / pitch /
  // interview) — visible placement, never injected into AI-generated text.
  const supportHtml = `<div class="support">💝 <a href="${SUPPORT_URL}" target="_blank" rel="noopener">支持项目</a>（推广返佣/打赏） · <a href="${TOMILITE_URL}" target="_blank" rel="noopener">TomiLite</a>（作者的 AI 助手）</div>`;
  setPanelHtml(
    `<div class="h">${escapeHtml(content.title)}</div>${spinner}${rows}${tagsHtml}${pitchHtml}${errorHtml}${inputHtml}<div style="margin-top:8px">${actionsHtml}</div>${supportHtml}`,
  );
  const s = ensurePanel();
  if (content.input && content.onInput) {
    const ta = s.querySelector('textarea.feedback') as HTMLTextAreaElement | null;
    if (ta) ta.addEventListener('input', () => content.onInput?.(ta.value));
  }
  for (const a of content.actions ?? []) {
    const el = s.querySelector(`[data-action="${a.label}"]`);
    if (el) el.addEventListener('click', a.onClick);
  }
  wireToggle();
}

/** Returns the toggle button so pages can show/hide the whole widget. */
export function hidePanel(): void {
  host?.remove();
  host = null;
  shadow = null;
}

// --- Core interaction flows shared by both sites ---

export interface CapturedContext {
  jd: JdCaptureInput;
  jobUid?: string;
  tags?: JdTags | null;
}

/** Renders the tagged panel — shared by core and direct backends. */
export function showTaggedPanel(ctx: CapturedContext, panelTitle: string): void {
  showPanel({
    title: panelTitle,
    rows: [],
    tags: ctx.tags ?? undefined,
    actions: [
      { label: '生成打招呼语', onClick: () => void generatePitch(ctx, panelTitle), primary: true },
      { label: '匹配度打分', onClick: () => void showMatch(ctx, panelTitle) },
      { label: '准备面试', onClick: () => void showInterviewPrep(ctx, panelTitle) },
      { label: '加入看板', onClick: () => void addToBoard(ctx, panelTitle) },
      { label: '重新导入', onClick: () => void captureAndShow(ctx, panelTitle, true) },
    ],
  });
}

/** Identity of the JD the last completed analysis belongs to. */
let lastCapturedKey: string | null = null;

function jdKey(jd: JdCaptureInput): string {
  return `${jd.title}|${jd.company}`;
}

export async function captureAndShow(
  ctx: CapturedContext,
  panelTitle: string,
  force = false,
): Promise<void> {
  // Cached analysis: navigating back reuses the tags. Identity is CONTENT-
  // based (title|company), not URL — Boss直聘's jobs page is an SPA where
  // switching JDs keeps the URL unchanged. 重新导入 (force) always re-runs.
  if (!force && ctx.tags && jdKey(ctx.jd) === lastCapturedKey) {
    showTaggedPanel(ctx, panelTitle);
    return;
  }
  await saveLastJd(ctx.jd);
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在导入并分析 JD…'] });
  const backend = await detectBackend();

  if (backend === 'core') {
    try {
      const { jobUid, taggingJobId } = await client.captureJd(ctx.jd);
      ctx.jobUid = jobUid;
      // Show the JD summary immediately + a ticking wait time, so the wait
      // never feels stuck (claude-code engine takes 30-60s; API providers 2-5s).
      const startedAt = Date.now();
      let settled = false;
      const tick = (): void => {
        if (settled) return;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        showPanel({
          state: 'tagging',
          title: panelTitle,
          rows: [
            `已导入：${ctx.jd.title} @ ${ctx.jd.company}`,
            ctx.jd.salaryText ? `薪资：${ctx.jd.salaryText}` : '',
            `AI 结构化分析中…已等待 ${elapsed}s`,
            elapsed >= 15
              ? '较慢？把设置页服务商换成 DeepSeek / Qwen 只需 2-5 秒（Claude Code 引擎需 30-60 秒）。'
              : '',
          ].filter(Boolean),
        });
      };
      tick();
      const timer = setInterval(tick, 1000);
      client.watch((event) => {
        if (event.type === 'jd/tagged' && event.jobId === taggingJobId) {
          settled = true;
          clearInterval(timer);
          ctx.tags = event.tags;
          if (event.tags) {
            lastCapturedKey = jdKey(ctx.jd);
            showTaggedPanel(ctx, panelTitle);
          } else {
            showPanel({
              state: 'error',
              title: panelTitle,
              rows: [],
              error: `标签化失败: ${event.error ?? '未知错误'}`,
            });
          }
        }
      });
    } catch (err) {
      showPanel({
        state: 'error',
        title: panelTitle,
        rows: [],
        error: `本地 Core 服务异常 (${CORE_BASE}): ${(err as Error).message}`,
        actions: [{ label: '重试', onClick: () => void captureAndShow(ctx, panelTitle) }],
      });
    }
    return;
  }

  // Direct mode — no local service needed, LLM called from the extension
  try {
    const tags = await backendTag(ctx.jd);
    ctx.tags = tags;
    lastCapturedKey = jdKey(ctx.jd);
    showTaggedPanel(ctx, panelTitle);
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `分析失败: ${(err as Error).message}`,
      actions: [{ label: '重试', onClick: () => void captureAndShow(ctx, panelTitle) }],
    });
  }
}

export async function generatePitch(
  ctx: CapturedContext,
  panelTitle: string,
  feedback?: string,
): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在生成打招呼语…'] });
  try {
    const result: GreetingResult = await backendGreeting(
      {
        title: ctx.jd.title,
        company: ctx.jd.company,
        salaryText: ctx.jd.salaryText,
        requirements: ctx.jd.requirements,
        hrName: ctx.jd.hrName,
      },
      feedback,
    );
    // Handoff: 立即沟通 navigates to /web/geek/chat/* — the chat page script
    // reads the pitch back from chrome.storage.session.
    await savePitch({ pitch: result.pitch, jdTitle: ctx.jd.title, ts: Date.now() });
    const rows = result.warning ? [result.warning] : [];
    showPanel({
      title: panelTitle,
      rows,
      pitch: result.pitch,
      actions: [
        { label: '填入聊天框', onClick: () => void fillPitch(result.pitch, false, () => showPitchPanel(result, rows)), primary: true },
        { label: '重新生成（可填意见）', onClick: () => showRegeneratePanel(ctx, panelTitle) },
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `生成失败: ${(err as Error).message}`,
      actions: [
        { label: '重试', onClick: () => void generatePitch(ctx, panelTitle, feedback) },
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  }

  function showPitchPanel(result: GreetingResult, rows: string[]): void {
    showPanel({
      title: panelTitle,
      rows,
      pitch: result.pitch,
      actions: [
        { label: '填入聊天框', onClick: () => void fillPitch(result.pitch, false, () => showPitchPanel(result, rows)), primary: true },
        { label: '重新生成（可填意见）', onClick: () => showRegeneratePanel(ctx, panelTitle) },
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  }
}

/** Regeneration with optional feedback — textarea + two paths. */
function showRegeneratePanel(ctx: CapturedContext, panelTitle: string): void {
  let feedback = '';
  showPanel({
    title: panelTitle,
    rows: ['对上一版不满意？可填写修改意见（可选），然后重新生成：'],
    input: { placeholder: '例：语气更简洁 / 突出 K8s 经验 / 不要提加班 / 换个结尾提问' },
    onInput: (v) => {
      feedback = v;
    },
    actions: [
      { label: '按意见重新生成', onClick: () => void generatePitch(ctx, panelTitle, feedback.trim() || undefined), primary: true },
      { label: '直接重新生成', onClick: () => void generatePitch(ctx, panelTitle) },
      { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
    ],
  });
}

// --- Send mode (manual confirm vs auto-send) ---

export type SendMode = 'manual' | 'auto';

export async function getSendMode(): Promise<SendMode> {
  try {
    const data = await chrome.storage.local.get('tomihunt-send-mode');
    return data['tomihunt-send-mode'] === 'auto' ? 'auto' : 'manual';
  } catch {
    return 'manual';
  }
}

// Chat-box selector chain: zhipin (contenteditable + textarea variants) and
// liepin candidates + generic fallbacks. Order matters — first hit wins.
const CHAT_INPUT_SELECTORS = [
  '#chat-input.chat-input[contenteditable="true"]',
  '.chat-input[contenteditable="true"]',
  '.chat-input',
  '.im-chat-input textarea',
  '.im-input textarea',
  '.chat-message-input textarea',
  '.input-area textarea',
  '.message-input textarea',
  'textarea',
  '[contenteditable="true"]',
];

const SEND_BUTTON_SELECTORS = [
  'button.btn-send',
  '.chat-op button',
  '.chat-op [class*="send"]',
  '.im-send-btn',
  'button.send-btn',
  '[class*="send-btn"]',
  'button[class*="send"]',
];

/** Presses Enter on the chat input (primary send path on both sites). */
function pressEnterOnInput(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  // Only fire Enter on plausible chat inputs — dispatching on a random
  // focused element (e.g. body) would swallow the send-button fallback.
  const isChatInput =
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el.isContentEditable ||
    /chat|im-input|message/i.test(typeof el.className === 'string' ? el.className : '');
  if (!isChatInput) return false;
  for (const type of ['keydown', 'keypress', 'keyup'] as const) {
    el.dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
    );
  }
  return true;
}

/** Clicks the first visible send button candidate. */
function clickSendButton(): boolean {
  for (const sel of SEND_BUTTON_SELECTORS) {
    for (const btn of document.querySelectorAll<HTMLElement>(sel)) {
      const visible =
        typeof btn.checkVisibility === 'function'
          ? btn.checkVisibility()
          : getComputedStyle(btn).display !== 'none';
      if (visible) {
        btn.click();
        return true;
      }
    }
  }
  return false;
}

/**
 * Sends the message currently sitting in the chat input. Enter-key path
 * first (what the sites' own React handlers listen for), send-button click
 * as fallback.
 */
export function sendChatMessage(): boolean {
  return pressEnterOnInput() || clickSendButton();
}

// 立即沟通/继续沟通 button candidates — clicking one opens the chat window
// (zhipin navigates to /web/geek/chat, liepin opens its chat panel).
const OPEN_CHAT_SELECTORS = [
  'a.op-btn.op-btn-chat',
  '.op-btn-chat',
  'a[ka*="chat"]',
  '[class*="start-chat"]',
  'button[class*="chat-now"]',
  '.btn-start-chat',
];

/**
 * Shared fill routine. When autoSend is undefined the stored send mode
 * decides (default: manual — fill only, user clicks send themselves).
 * If no chat input exists yet, tries to OPEN the chat window itself by
 * clicking the site's 立即沟通 button, then retries filling.
 */
export async function fillPitch(
  pitch: string,
  autoSend?: boolean,
  back?: () => void,
): Promise<void> {
  const shouldAuto = autoSend ?? ((await getSendMode()) === 'auto');
  const filled = fillChatBox(pitch, CHAT_INPUT_SELECTORS);
  if (!filled) {
    const opened = clickOpenChatButton();
    if (opened) {
      // Chat window opening: zhipin SPA-navigates (the chat-page script takes
      // over with the stored pitch) or liepin opens a panel in place — poll
      // briefly and fill if the input appears here.
      showPanel({
        state: 'tagging',
        title: 'TomiHunt',
        rows: ['已帮你点击「立即沟通」打开聊天窗口…'],
        pitch,
      });
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setTimeout(r, 800));
        if (fillChatBox(pitch, CHAT_INPUT_SELECTORS)) {
          if (shouldAuto) {
            await new Promise((r) => setTimeout(r, 600));
            const sent = sendChatMessage();
            showPanel({
              title: 'TomiHunt',
              rows: sent ? ['✅ 已自动发送。'] : ['已填入 — 请手动按 Enter 发送（内容已保留）。'],
              pitch,
              actions: back ? [{ label: '返回', onClick: back }] : [],
            });
          } else {
            showPanel({
              title: 'TomiHunt',
              rows: ['✅ 已填入聊天框，确认后自行点击发送。'],
              pitch,
              actions: back ? [{ label: '返回', onClick: back }] : [],
            });
          }
          return;
        }
      }
      // zhipin navigated away — the chat page script handles it; this page
      // may be gone already. Leave a graceful note + back path.
      showPanel({
        title: 'TomiHunt',
        rows: ['已打开聊天窗口。若跳转到聊天页，话术会自动带过去，点击面板「填入聊天框」即可。'],
        pitch,
        actions: back ? [{ label: '返回', onClick: back }] : [],
      });
      return;
    }
    showPanel({
      title: 'TomiHunt',
      rows: ['未找到聊天框输入区，页面上也没找到「立即沟通 / 聊一聊」按钮 — 请手动打开聊天窗口后再点一次。'],
      pitch,
      actions: back ? [{ label: '返回', onClick: back }] : [],
    });
    return;
  }
  if (shouldAuto) {
    // Safety governor: auto-send is rate-limited so even heavy usage can
    // never look like bulk messaging. Exceeding the cap degrades to fill-
    // only with a notice (the user can still send manually).
    const now = Date.now();
    if (now - lastAutoSendAt < AUTO_SEND_MIN_INTERVAL_MS || autoSendCount >= AUTO_SEND_MAX_PER_SESSION) {
      showPanel({
        title: 'TomiHunt',
        rows: ['⚠️ 自动发送过于频繁，已降级为「填入后手动发送」以保护你的账号。'],
        pitch,
        actions: back ? [{ label: '返回', onClick: back }] : [],
      });
      return;
    }
    lastAutoSendAt = now;
    autoSendCount += 1;
    // Give the site's React state a beat to settle, then send.
    await new Promise((r) => setTimeout(r, 800));
    const sent = sendChatMessage();
    showPanel({
      title: 'TomiHunt',
      rows: sent
        ? ['✅ 已自动发送。如需调整，可再次生成。']
        : ['已填入但未找到发送按钮 — 请手动按 Enter 发送（内容已保留）。'],
      pitch,
      actions: back ? [{ label: '返回', onClick: back }] : [],
    });
    return;
  }
  showPanel({
    title: 'TomiHunt',
    rows: ['✅ 已填入聊天框，确认后自行点击发送。'],
    pitch,
    actions: back ? [{ label: '返回', onClick: back }] : [],
  });
}

/** Chat-open button labels across sites (zhipin: 立即沟通/继续沟通; liepin: 聊一聊). */
const CHAT_OPEN_LABELS = ['沟通', '聊一聊', '私聊'];

/** Clicks the first visible 立即沟通 / 继续沟通 / 聊一聊 button on the page. */
export function clickOpenChatButton(): boolean {
  const tryClick = (el: HTMLElement): boolean => {
    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text.length > 12) return false; // paragraphs, not buttons
    if (CHAT_OPEN_LABELS.some((label) => text.includes(label))) {
      el.click();
      return true;
    }
    return false;
  };
  for (const sel of OPEN_CHAT_SELECTORS) {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (tryClick(el)) return true;
    }
  }
  // Label-scan fallback over every clickable element (site markup drifts).
  for (const el of document.querySelectorAll<HTMLElement>('a, button, [role="button"]')) {
    if (tryClick(el)) return true;
  }
  return false;
}

// --- Phase 2/3 panel actions: match scoring + interview prep ---

export async function showMatch(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在计算匹配度（0-100）…'] });
  try {
    const result = (await backendMatch({
      title: ctx.jd.title,
      company: ctx.jd.company,
      salaryText: ctx.jd.salaryText,
      requirements: ctx.jd.requirements,
    })) as {
      score: number;
      verdict: string;
      strengths: string[];
      gaps: string[];
      risks: string[];
    };
    const rows = [
      `综合得分 ${result.score} 分 · ${result.verdict}`,
      ...(result.score >= 85 ? ['🎯 匹配度高，可直接生成打招呼语'] : []),
      ...(result.strengths.length > 0 ? ['', '✅ 优势:'] : []),
      ...result.strengths.map((s) => `  · ${s}`),
      ...(result.gaps.length > 0 ? ['', '⚠️ 短板:'] : []),
      ...result.gaps.map((g) => `  · ${g}`),
      ...(result.risks.length > 0 ? ['', '🚨 避坑:'] : []),
      ...result.risks.map((r) => `  · ${r}`),
    ];
    showPanel({
      title: `${panelTitle} — 匹配度`,
      rows,
      actions: [
        // High fit ⇒ straight to the pitch, no navigation detour.
        ...(result.score >= 85
          ? [{ label: '生成打招呼语', onClick: () => void generatePitch(ctx, panelTitle), primary: true }]
          : []),
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `打分失败: ${(err as Error).message}`,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  }
}

export async function addToBoard(ctx: CapturedContext, panelTitle: string): Promise<void> {
  if ((await detectBackend()) === 'direct') {
    showPanel({
      title: panelTitle,
      rows: ['看板是本地 Core 服务的进阶功能。', '启动方式：双击项目里的 start.bat（无需命令行）。'],
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
    return;
  }
  try {
    const base = (await getCoreBase()) ?? CORE_BASE;
    const resp = await fetch(`${base}/v1/board`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'greeted',
        company: ctx.jd.company,
        title: ctx.jd.title,
        url: ctx.jd.url,
      }),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    showPanel({
      title: panelTitle,
      rows: ['✅ 已加入看板（已打招呼）', '看板文件: ~/.tomi-job-hunt/board.md'],
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  } catch (err) {
    showPanel({ state: 'error', title: panelTitle, rows: [], error: `加入看板失败: ${(err as Error).message}` });
  }
}

export async function showInterviewPrep(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在预测面试题…'] });
  try {
    const result = (await backendInterview({
      title: ctx.jd.title,
      company: ctx.jd.company,
      salaryText: ctx.jd.salaryText,
      requirements: ctx.jd.requirements,
    })) as { questions: Array<{ q: string; intent: string; starHint: string }> };
    const rows = result.questions.flatMap((question, i) => [
      `Q${i + 1}. ${question.q}`,
      `  考察: ${question.intent}`,
      `  建议: ${question.starHint}`,
      '',
    ]);
    showPanel({
      title: `${panelTitle} — 面试准备`,
      rows,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `面试准备失败: ${(err as Error).message}`,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
