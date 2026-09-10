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
import { addBoardEntry, loadBoard } from '../direct/board.js';
import {
  addFeedback,
  aggregatePersonalRules,
  FEEDBACK_TAGS,
  loadFeedback,
  personalRulesPrompt,
} from '../direct/feedback.js';
import { loadResume } from '../direct/resume.js';

export const client = new CoreClient();

/** Chrome kills chrome.* access on pages open during an extension reload. */
export function isContextInvalidated(err: unknown): boolean {
  return err instanceof Error && /context invalidated/i.test(err.message);
}

/** Friendly panel state for the invalidation case — with a refresh action. */
export function contextInvalidatedPanel(title: string): void {
  showPanel({
    state: 'error',
    title,
    rows: ['插件刚被更新或重载，当前页面的插件上下文已失效。', '刷新页面后即可正常使用（你的数据都在）。'],
    actions: [{ label: '🔄 刷新页面', onClick: () => location.reload(), primary: true }],
  });
}

/** Support/donation page (QR codes + affiliate links) — footer of every panel state. */
const SUPPORT_URL = 'https://github.com/xxwj225-James/tomi-job-hunt#%E6%94%AF%E6%8C%81%E9%A1%B9%E7%9B%AE';
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

/** First non-empty cleaned text across candidate selectors (site markup drifts).
 *  `root` may be a narrowed container — see zhipin's detailScope(). */
export function pickText(root: ParentNode, selectors: string[]): string {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    if (!el) continue;
    const text = stripHidden(el).textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

/** The element behind {@link pickLongText} — callers that need to walk up the
 *  DOM (zhipin's detailScope) must know WHERE the long text came from. */
export function pickLongTextEl(root: ParentNode, selectors: string[]): Element | null {
  let best: Element | null = null;
  let bestLen = 0;
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      const text = stripHidden(el).textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > bestLen) {
        bestLen = text.length;
        best = el;
      }
    }
  }
  return best;
}

/** Picks the longest cleaned text among candidates — JD sections are long-form.
 *  `root` may be a narrowed container — see zhipin's detailScope(). */
export function pickLongText(root: ParentNode, selectors: string[]): string {
  const el = pickLongTextEl(root, selectors);
  return el ? (stripHidden(el).textContent?.replace(/\s+/g, ' ').trim() ?? '') : '';
}

/**
 * Fills the zhipin chat box. Real-world (2026): it is a contenteditable div,
 * not a textarea — set textContent, put the caret at the end, dispatch
 * beforeinput/input so React state syncs. Textarea fallback kept for edge
 * layouts and the native-setter trick for React-controlled textareas.
 */
export function fillChatBox(text: string, selectors: string[], doc: Document = document): boolean {
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLElement>(sel);
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
      const docWin = doc.defaultView ?? window;
      const selection = docWin.getSelection();
      const range = doc.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
    el.focus();
    rememberOutgoing(text);
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

/**
 * Side classification via real layout markers, not just class names:
 *  - explicit self/right/left/other classes (zhipin)
 *  - computed text-align / float
 *  - flex auto-margins: `margin-left:auto` pushes MY bubble to the right,
 *    `margin-right:auto` pushes the OTHER side's bubble to the left
 *  - `align-self:flex-end` (column chat lists right-align my bubble)
 * Returns 'mine' / 'theirs' / 'unknown' — a bubble with NO marker at all is
 * 'unknown', NOT 'theirs', so page-load scans never guess on an unmarked
 * backlog (that used to fire a spurious reply on our OWN past messages, which
 * liepin renders without any side marker).
 * (Inline-style fallback keeps jsdom tests green — getComputedStyle there
 * returns '' for styles that real browsers compute.)
 */
type MessageSide = 'mine' | 'theirs' | 'unknown';

function classifySide(el: Element): MessageSide {
  const cls = typeof el.className === 'string' ? el.className : '';
  if (/(^|[ _-])(self|right|mine|me)([ _-]|$)/i.test(cls)) return 'mine';
  if (/(^|[ _-])(left|from|other)([ _-]|$)/i.test(cls)) return 'theirs';
  const computed = getComputedStyle(el);
  const inline = (el as HTMLElement).style;
  const textAlign = computed.textAlign || inline.textAlign;
  const cssFloat = computed.cssFloat || inline.cssFloat;
  if (cssFloat === 'right' || textAlign === 'right') return 'mine';
  const ml = computed.marginLeft || inline.marginLeft;
  const mr = computed.marginRight || inline.marginRight;
  if (ml === 'auto' && mr !== 'auto') return 'mine';
  if (mr === 'auto' && ml !== 'auto') return 'theirs';
  const alignSelf = computed.alignSelf || inline.alignSelf;
  if (alignSelf === 'flex-end' || alignSelf === 'end') return 'mine';
  if (alignSelf === 'flex-start' || alignSelf === 'start') return 'theirs';
  return 'unknown';
}

// Texts the extension itself filled into / sent from the chat box. Echoes of
// these in the DOM are OUR messages (they get classified as theirs only when
// the site's markup carries no side marker, e.g. liepin) — never incoming HR
// messages, so they must not trigger a reply. The window is long on purpose:
// an Agent-driven fill lands in the box but the user may press send in the
// browser MINUTES later (they review the pitch in the desktop app first), so
// the outgoing echo can appear well after the fill.
const OUTGOING_WINDOW_MS = 30 * 60_000;
const recentOutgoing: Array<{ text: string; ts: number }> = [];

function rememberOutgoing(text: string): void {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 2) return;
  recentOutgoing.push({ text: t, ts: Date.now() });
  // Liepin renders a multi-line message as per-line bubbles (and a single-line
  // input may only send the first line), so the echo can be ONE line of what
  // we sent. Remember each non-trivial line too — the echo then matches
  // exactly instead of being misread as an incoming HR message.
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    if (line.length >= 2) recentOutgoing.push({ text: line, ts: Date.now() });
  }
  while (recentOutgoing.length > 40) recentOutgoing.shift();
}

function isRecentOutgoing(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  const now = Date.now();
  return recentOutgoing.some((r) => {
    if (now - r.ts >= OUTGOING_WINDOW_MS) return false;
    if (r.text === t) return true;
    // Echo may be a truncated/fragmented copy of our sent message (liepin
    // splits long messages). A ≥4-char fragment that lives inside our sent
    // text is ours, never incoming HR content.
    if (t.length >= 4 && r.text.includes(t)) return true;
    // The observer may match a container node whose textContent bundles MORE
    // than the bubble — sender name / time around our message (e.g. liepin's
    // "王先生 09:12 <我们的消息>"). Our full sent text then sits inside t, so
    // suppress it too. A real incoming HR message never embeds a 4+-char run
    // of what WE just sent (both sides gated so a short "好的" send can't
    // blanket-suppress an HR message that happens to start with it).
    if (t.length >= 4 && r.text.length >= 4 && t.includes(r.text)) return true;
    return false;
  });
}

/**
 * Watches the chat area for NEW incoming messages (from the other side).
 * Dedupes by content; fires onIncoming(text) once per new message.
 * Returns a stop function.
 *
 * Messages already in the DOM when we attach fire ONLY on a positive "theirs"
 * signal — an unmarked backlog (e.g. our own history on liepin, which has no
 * side marker) must never be guessed at, or every page load mid-conversation
 * would draft a reply to our own previous message.
 */
/**
 * A NEW bubble with NO side marker (liepin's default markup) is ambiguous: it
 * can be an incoming HR message, or an echo of what the USER just sent (hand-
 * typed, or an Agent fill the user edited). Sending clears the chat box and
 * trackChatInputSends records the sent text as outgoing — but that record can
 * land a moment AFTER the echo appends. So an unmarked bubble is held briefly
 * and re-checked against the outgoing set before it can fire a reply.
 */
const UNMARKED_CONFIRM_MS = 250;

export function observeChatMessages(onIncoming: (text: string) => void): () => void {
  const seen = new Set<string>();
  const consider = (el: Element, allowUnknown: boolean): void => {
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    if (seen.has(text)) return;
    if (isRecentOutgoing(text)) return; // an echo of what we just sent/filled
    const side = classifySide(el);
    if (side === 'mine') return; // my own messages never trigger replies
    if (!allowUnknown && side !== 'theirs') return; // ambiguous backlog — never guess
    seen.add(text);
    if (side === 'unknown') {
      setTimeout(() => {
        if (isRecentOutgoing(text)) return; // it was OUR sent echo — never a reply
        onIncoming(text);
      }, UNMARKED_CONFIRM_MS);
      return;
    }
    onIncoming(text);
  };
  // Existing messages first (page load mid-conversation) — only the ones the
  // markup/layout clearly marks as the other side.
  for (const sel of MSG_SELECTORS) {
    for (const el of document.querySelectorAll(sel)) consider(el, false);
  }
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const el = node.matches(MSG_SELECTORS.join(','))
          ? node
          : node.querySelector(MSG_SELECTORS.join(','));
        if (el) consider(el, true);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// --- Smart reply: HR message → AI draft → fill (user sends) ---

const LAST_JD_KEY = 'tomihunt-last-jd';

/** The last JD shown in this browser session, and when it was shown. */
export interface LastJd {
  jd: JdCaptureInput;
  at: number;
}

export async function saveLastJd(jd: JdCaptureInput): Promise<void> {
  try {
    await chrome.storage.session.set({ [LAST_JD_KEY]: { jd, at: Date.now() } satisfies LastJd });
  } catch {
    // session storage unavailable — reply falls back to generic context
  }
}

/**
 * Reads the last-shown JD with its timestamp. The timestamp is what lets a chat
 * page decide whether "the JD the user was just looking at" is the conversation
 * it is showing (立即沟通 navigates within seconds) or a stale leftover.
 *
 * Tolerates the pre-timestamp plain-JD shape (a browser session that started
 * before this build): reported as `at: 0`, i.e. permanently stale, so it can
 * serve smart-reply context but never identity a chat session.
 */
export async function loadLastJd(): Promise<LastJd | null> {
  try {
    const data = await chrome.storage.session.get(LAST_JD_KEY);
    const raw = data[LAST_JD_KEY] as (LastJd & Partial<JdCaptureInput>) | undefined;
    if (!raw) return null;
    if (raw.jd) return raw as LastJd;
    return { jd: raw as JdCaptureInput, at: 0 };
  } catch {
    return null;
  }
}

/** Rolling conversation history observed on this page (for reply context). */
const replyHistory: Array<{ speaker: 'hr' | 'me'; content: string }> = [];
let lastReplyAt = 0;
const REPLY_COOLDOWN_MS = 10_000;

/**
 * True once the desktop Agent has taken over this page (see enterAgentMode).
 * Every panel flow — the capture/tagging per-second tick, tagged completion,
 * smart reply, errors — funnels through showPanel, so one guard there keeps the
 * in-page floating widget away for the rest of this page session once the Agent
 * is the active UI. Resets naturally on navigation/reload (the content script
 * re-runs). A one-shot hidePanel() is NOT enough: the tagging tick / a tagged
 * event can land AFTER a dispatch and would otherwise re-create the host.
 */
let agentMode = false;

/**
 * The desktop Agent is now driving this page: drop any floating widget and
 * never let it reappear until the page is reloaded. Backend captures keep going
 * to the local service silently — only the on-page UI is suppressed. Also stops
 * the smart reply auto-draft, which would otherwise overwrite the very chat box
 * the Agent is using.
 */
export function enterAgentMode(): void {
  agentMode = true;
  hidePanel();
}

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
  if (agentMode) return; // the Agent drives this page — no auto drafts/fills
  if (!(await smartReplyEnabled())) return;
  const now = Date.now();
  if (now - lastReplyAt < REPLY_COOLDOWN_MS) return;
  lastReplyAt = now;

  replyHistory.push({ speaker: 'hr', content: text });
  const jd = (await loadLastJd())?.jd ?? null;
  const resume = await loadResume();
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
      actions: [
        ...(lastTagged
          ? [{ label: '返回', onClick: () => showTaggedPanel(lastTagged!.ctx, lastTagged!.panelTitle) }]
          : [{ label: '打开工作台', onClick: () => void chrome.tabs.create({ url: chrome.runtime.getURL('workspace.html') }) }]),
      ],
    });
  } catch {
    // generation failure — stay silent, the user can reply manually
  }
}

/**
 * Records text the USER sends from the chat box into the same recentOutgoing
 * set that already suppresses echoes of extension-filled messages. Needed
 * because a message typed by hand (or an Agent fill the user edited before
 * sending) is never recorded by fillChatBox — yet on liepin it echoes back with
 * no side marker and the observer can't tell it from an incoming HR message.
 *
 * Signals that a send happened, without depending on the site's DOM markers:
 *  - Enter keydown in the input (textarea/contenteditable) while NOT composing
 *    IME — Enter sends on these IM sites; record the draft before the echo can
 *    be observed. (IME composition Enter is guarded so Chinese input confirm
 *    steps don't count as sends.)
 *  - the input being emptied by an 'input' event after holding text — sending
 *    clears the box (button sends).
 */
export function trackChatInputSends(doc: Document = document): () => void {
  const isChatInput = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement && t.matches(CHAT_INPUT_SELECTORS.join(','));
  const textOf = (el: HTMLElement): string =>
    (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el.value : (el.textContent ?? ''))
      .replace(/\s+/g, ' ')
      .trim();
  const lastText = new WeakMap<Element, string>();
  const record = (el: HTMLElement): void => {
    const t = textOf(el);
    if (t.length >= 2) rememberOutgoing(t);
  };
  // Existing chat inputs: snapshot so a later clear can be compared to what was
  // in the box before the send.
  for (const el of doc.querySelectorAll<HTMLElement>(CHAT_INPUT_SELECTORS.join(','))) {
    lastText.set(el, textOf(el));
  }
  const onInput = (ev: Event): void => {
    if (!isChatInput(ev.target)) return;
    const el = ev.target as HTMLElement;
    const prev = lastText.get(el);
    const cur = textOf(el);
    if (prev && prev.length >= 2 && cur.length === 0) rememberOutgoing(prev); // box cleared = sent
    lastText.set(el, cur);
  };
  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.isComposing || ev.keyCode === 229) return; // IME composition — not a send
    if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) record(t);
  };
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKeydown, true);
  return () => {
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('keydown', onKeydown, true);
  };
}

/** Wires the observer on chat-capable pages. */
export function watchChatForReplies(): void {
  trackChatInputSends(); // recognize OUR sends even when the site marks nothing
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
  /** Board context for auto-logging a greeted entry when the pitch is sent. */
  company?: string;
  url?: string;
  ts: number;
}

export async function savePitch(pitch: StoredPitch): Promise<void> {
  try {
    await chrome.storage.session.set({ 'tomihunt-pitch': pitch });
  } catch {
    // storage unavailable — pitch stays on the current page only
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
.fb-bar { margin-top: 10px; padding: 8px; background: #f8f9fb; border-radius: 8px; font-size: 12px; }
.fb-bar .fb-prompt { color: #666; margin-bottom: 6px; }
.fb-bar .fb-ops { display: flex; gap: 6px; }
.fb-bar button { padding: 4px 10px; border: 1px solid #d0d5dd; border-radius: 12px; background: #fff; cursor: pointer; font-size: 12px; color: #444; }
.fb-bar button.on { background: #4f7cff; border-color: #4f7cff; color: #fff; }
.fb-bar .fb-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.fb-bar .fb-note { width: 100%; box-sizing: border-box; margin: 4px 0; padding: 6px; border: 1px solid #d0d5dd; border-radius: 6px; font: inherit; font-size: 12px; }
.fb-bar .fb-done { color: #1a7f37; font-size: 12px; }
.hidden { display: none !important; }
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
  /** Renders a 👍/👎 feedback bar; submissions persist to `tomihunt-feedback`. */
  feedback?: { feature: string };
}): void {
  if (agentMode) return; // the desktop Agent is driving this page — no widget
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
  const fbHtml = content.feedback ? feedbackBarHtml(content.feedback) : '';
  // Support footer appears on EVERY panel state (tags / match / pitch /
  // interview) — visible placement, never injected into AI-generated text.
  const supportHtml = `<div class="support">💝 <a href="${SUPPORT_URL}" target="_blank" rel="noopener">支持项目</a> · <a href="${TOMILITE_URL}" target="_blank" rel="noopener">TomiLite</a>（作者的 AI 助手）</div>`;
  setPanelHtml(
    `<div class="h">${escapeHtml(content.title)}</div>${spinner}${rows}${tagsHtml}${pitchHtml}${errorHtml}${inputHtml}<div style="margin-top:8px">${actionsHtml}</div>${fbHtml}${supportHtml}`,
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
  if (content.feedback) {
    const bar = s.querySelector('.fb-bar');
    if (bar) wireFeedbackBar(bar as HTMLElement, content.feedback);
  }
  wireToggle();
}

/** Feedback bar markup — thumbs, complaint chips (down), optional note. */
function feedbackBarHtml(opts: { feature: string }): string {
  return `
    <div class="fb-bar" data-feature="${escapeHtml(opts.feature)}">
      <div class="fb-prompt">这个结果怎么样？你的偏好会影响后续生成 👇</div>
      <div class="fb-ops">
        <button data-fb="up">👍 不错</button>
        <button data-fb="down">👎 待改进</button>
      </div>
      <div class="fb-edit hidden">
        <div class="fb-tags hidden"></div>
        <textarea class="fb-note hidden" rows="2" placeholder="补充说明（可选）"></textarea>
        <button class="fb-save">保存反馈</button>
      </div>
      <div class="fb-done hidden">✅ 已记录你的偏好，后续生成会参考。</div>
    </div>`;
}

/** Wires thumbs → chips → note → save → `addFeedback` into chrome.storage. */
function wireFeedbackBar(el: HTMLElement, opts: { feature: string }): void {
  const ops = el.querySelector('.fb-ops') as HTMLElement;
  const edit = el.querySelector('.fb-edit') as HTMLElement;
  const tags = el.querySelector('.fb-tags') as HTMLElement;
  const note = el.querySelector('.fb-note') as HTMLTextAreaElement;
  const save = el.querySelector('.fb-save') as HTMLButtonElement;
  const done = el.querySelector('.fb-done') as HTMLElement;
  let thumbs: 'up' | 'down' | null = null;
  const selected: string[] = [];

  const renderTags = (): void => {
    tags.classList.remove('hidden');
    tags.innerHTML = Object.entries(FEEDBACK_TAGS)
      .map(
        ([id, label]) =>
          `<button data-tag="${id}" class="${selected.includes(id) ? 'on' : ''}">${escapeHtml(label)}</button>`,
      )
      .join('');
    for (const btn of tags.querySelectorAll<HTMLButtonElement>('button[data-tag]')) {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag ?? '';
        const i = selected.indexOf(tag);
        if (i >= 0) selected.splice(i, 1);
        else selected.push(tag);
        btn.classList.toggle('on');
      });
    }
  };

  for (const btn of ops.querySelectorAll<HTMLButtonElement>('button[data-fb]')) {
    btn.addEventListener('click', () => {
      thumbs = (btn.dataset.fb as 'up' | 'down') ?? null;
      ops.classList.add('hidden');
      edit.classList.remove('hidden');
      note.classList.remove('hidden');
      save.classList.remove('hidden');
      if (thumbs === 'down') renderTags();
      else tags.classList.add('hidden');
    });
  }

  save.addEventListener('click', async () => {
    if (!thumbs) return;
    await addFeedback({
      feature: opts.feature,
      thumbs,
      tags: selected,
      note: note.value.trim() || undefined,
    });
    edit.classList.add('hidden');
    done.classList.remove('hidden');
  });
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
  lastTagged = { ctx, panelTitle };
  showPanel({
    title: panelTitle,
    rows: [],
    tags: ctx.tags ?? undefined,
    actions: [
      { label: '生成打招呼语', onClick: () => void generatePitch(ctx, panelTitle), primary: true },
      { label: '匹配度打分', onClick: () => void showMatch(ctx, panelTitle) },
      { label: '准备面试', onClick: () => void showInterviewPrep(ctx, panelTitle) },
      { label: '记录到看板', onClick: () => void addToBoard(ctx, panelTitle) },
      { label: '重新导入', onClick: () => void captureAndShow(ctx, panelTitle, true) },
    ],
  });
}

/** Manual "记录到看板" — logs the current JD as a greeted board entry. */
async function addToBoard(ctx: CapturedContext, panelTitle: string): Promise<void> {
  const jd = ctx.jd;
  try {
    const entry = await addBoardEntry({
      status: 'greeted',
      company: jd.company || '未知公司',
      title: jd.title || '未知岗位',
      url: location.href,
      source: 'manual',
    });
    showPanel({
      title: panelTitle,
      rows: [`✅ 已记入看板「已打招呼」：${entry.title} @ ${entry.company}`, '在插件「🧰 工作台 → 看板」里可跟踪投递进度。'],
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `记录失败: ${(err as Error).message}`,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  }
}

// --- Panel "view epoch" guard (SPA JD switches without a URL change) ---
// Boss直聘's list/home/company pages open JD details in-place. The floating
// panel must always describe the job CURRENTLY viewed, so every async capture
// flow (import ticks, WS jd/tagged completion, direct-mode tagging, and the
// match/pitch/interview LLM calls) records the epoch when it starts and stops
// painting once a NEWER job view supersedes it — a slow old job's result can
// never paint over the job on screen. The single active-capture slot also lets
// enterJobView() dispose the previous capture's setInterval + WebSocket, which
// fixes a socket leak when SPA captures stack up (client.watch opened a fresh
// WebSocket per call and callers never closed it).
let viewEpoch = 0;
let activeCapture: { epoch: number; dispose: () => void } | null = null;

/** The currently displayed JD changed — superseded analyses must stop painting. */
export function enterJobView(): number {
  viewEpoch += 1;
  if (activeCapture) {
    activeCapture.dispose();
    activeCapture = null;
  }
  return viewEpoch;
}

/** True when `epoch` still describes the currently-viewed job. */
function isViewCurrent(epoch: number): boolean {
  return epoch === viewEpoch;
}

/** Identity of the JD the last completed analysis belongs to. */
let lastCapturedKey: string | null = null;

/** Last shown tagged panel — smart-reply / sub-panels return here. */
let lastTagged: { ctx: CapturedContext; panelTitle: string } | null = null;

function jdKey(jd: JdCaptureInput): string {
  return `${jd.title}|${jd.company}`;
}

export async function captureAndShow(
  ctx: CapturedContext,
  panelTitle: string,
  force = false,
): Promise<void> {
  // Epoch of the job view this capture belongs to. captureAndShow does NOT bump
  // the epoch itself — the BOSS SPA controller calls enterJobView() whenever the
  // displayed job changes. On single-JD pages (job_detail URLs, liepin) nothing
  // ever bumps, so the guards below are no-ops there and behavior is unchanged.
  const epoch = viewEpoch;
  // Cached analysis: navigating back reuses the tags. Identity is CONTENT-
  // based (title|company), not URL — Boss直聘's jobs page is an SPA where
  // switching JDs keeps the URL unchanged. 重新导入 (force) always re-runs.
  if (!force && ctx.tags && jdKey(ctx.jd) === lastCapturedKey) {
    if (!isViewCurrent(epoch)) return;
    showTaggedPanel(ctx, panelTitle);
    return;
  }
  await saveLastJd(ctx.jd);
  if (!isViewCurrent(epoch)) return; // switched jobs while we saved — don't spend tokens
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在导入并分析 JD…'] });
  const backend = await detectBackend();
  if (!isViewCurrent(epoch)) return; // switched during backend probe — never capture

  if (backend === 'core') {
    try {
      if (!isViewCurrent(epoch)) return;
      const { jobUid, taggingJobId } = await client.captureJd(ctx.jd);
      ctx.jobUid = jobUid;
      // Show the JD summary immediately + a ticking wait time, so the wait
      // never feels stuck (claude-code engine takes 30-60s; API providers 2-5s).
      const startedAt = Date.now();
      let settled = false;
      let disposed = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      let closer: (() => void) | undefined;
      // Closes the tick interval + WebSocket exactly once (on settle or on
      // supersede) — the watch socket used to leak because nothing closed it.
      const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        if (timer) {
          clearInterval(timer);
          timer = undefined;
        }
        try {
          closer?.();
        } catch {
          // socket already gone
        }
        if (activeCapture?.epoch === epoch) activeCapture = null;
      };
      const tick = (): void => {
        if (settled || !isViewCurrent(epoch)) {
          dispose(); // superseded — stop ticking, never paint an old job
          return;
        }
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
      // Claim the active slot BEFORE the socket opens so a job switch during
      // the open supersedes this capture and closes the socket once it lands.
      if (activeCapture && activeCapture.epoch !== epoch) {
        activeCapture.dispose();
        activeCapture = null;
      }
      if (!activeCapture) activeCapture = { epoch, dispose };
      tick();
      timer = setInterval(tick, 1000);
      closer = await client.watch((event) => {
        if (event.type !== 'jd/tagged' || event.jobId !== taggingJobId) return;
        settled = true;
        dispose(); // settle → close the socket (no leak)
        if (!isViewCurrent(epoch)) return; // core tagged an OLD job — stay silent
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
      });
      if (disposed) closer(); // superseded while the socket was opening
    } catch (err) {
      if (!isViewCurrent(epoch)) return; // superseded errors stay silent
      if (isContextInvalidated(err)) {
        contextInvalidatedPanel(panelTitle);
        return;
      }
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
    if (!isViewCurrent(epoch)) return; // an old job's direct tag stays silent
    ctx.tags = tags;
    lastCapturedKey = jdKey(ctx.jd);
    showTaggedPanel(ctx, panelTitle);
  } catch (err) {
    if (!isViewCurrent(epoch)) return;
    if (isContextInvalidated(err)) {
      contextInvalidatedPanel(panelTitle);
      return;
    }
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `分析失败: ${(err as Error).message}`,
      actions: [{ label: '重试', onClick: () => void captureAndShow(ctx, panelTitle) }],
    });
  }
}

/** Board context for the current JD — used to auto-log a greeted entry. */
function boardContext(ctx: CapturedContext): { company: string; title: string; url: string } {
  return { company: ctx.jd.company, title: ctx.jd.title, url: location.href };
}

export async function generatePitch(
  ctx: CapturedContext,
  panelTitle: string,
  feedback?: string,
): Promise<void> {
  const epoch = viewEpoch; // a pitch for a job the user already left stays silent
  if (!isViewCurrent(epoch)) return;
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在生成打招呼语…'] });
  try {
    // Prompt adaptation: merge the user's accumulated thumbs/tags/notes
    // ("personal rules") into the existing feedback param — works for both
    // direct and Core backends, no fine-tuning involved.
    const rulePrompt = personalRulesPrompt(aggregatePersonalRules(await loadFeedback()));
    const effectiveFeedback = [rulePrompt, feedback?.trim()].filter(Boolean).join('\n') || undefined;
    const result: GreetingResult = await backendGreeting(
      {
        title: ctx.jd.title,
        company: ctx.jd.company,
        salaryText: ctx.jd.salaryText,
        requirements: ctx.jd.requirements,
        hrName: ctx.jd.hrName,
      },
      effectiveFeedback,
      ctx.tags ?? undefined, // structured JD tags feed Stage-1 point extraction
    );
    // Handoff: 立即沟通 navigates to /web/geek/chat/* — the chat page script
    // reads the pitch back from chrome.storage.session.
    await savePitch({ pitch: result.pitch, jdTitle: ctx.jd.title, company: ctx.jd.company, url: location.href, ts: Date.now() });
    // Show the JD-oriented matching points the pitch was built from, so the
    // user sees the reframing and can eyeball that nothing was fabricated.
    const pointRows = (result.points ?? []).slice(0, 3).map((p) => `✅ 匹配点 · ${p.keyword}：${p.reframed}`);
    const rows = [...pointRows, ...(result.warning ? [result.warning] : [])];
    if (!isViewCurrent(epoch)) return; // switched jobs while the LLM ran — no stale paint
    showPanel({
      title: panelTitle,
      rows,
      pitch: result.pitch,
      feedback: { feature: 'greeting' },
      actions: [
        { label: '填入聊天框', onClick: () => void fillPitch(result.pitch, false, () => showPitchPanel(result, rows), boardContext(ctx)), primary: true },
        { label: '重新生成（可填意见）', onClick: () => showRegeneratePanel(ctx, panelTitle) },
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    if (!isViewCurrent(epoch)) return; // superseded errors stay silent
    if (isContextInvalidated(err)) {
      contextInvalidatedPanel(panelTitle);
      return;
    }
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
      feedback: { feature: 'greeting' },
      actions: [
        { label: '填入聊天框', onClick: () => void fillPitch(result.pitch, false, () => showPitchPanel(result, rows), boardContext(ctx)), primary: true },
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

// --- Send mode ---
// Auto-send was removed for compliance: the extension never triggers a send
// programmatically. Messages are always filled + highlighted for the user to
// review and send themselves (Enter / the site's send button).

export type SendMode = 'manual';

// Chat-box selector chain: zhipin (contenteditable + textarea variants) and
// liepin candidates + generic fallbacks. Order matters — first hit wins.
export const CHAT_INPUT_SELECTORS = [
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



/**
 * Highlights the chat input so the user notices a pitch was filled and is
 * awaiting review before sending. Clears after 6s.
 */
export function highlightChatInput(): void {
  const el = document.querySelector<HTMLElement>(CHAT_INPUT_SELECTORS.join(','));
  if (!el) return;
  const prevOutline = el.style.outline;
  const prevOutlineOffset = el.style.outlineOffset;
  el.style.outline = '2px solid #4f7cff';
  el.style.outlineOffset = '1px';
  setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOutlineOffset;
  }, 6000);
}

/**
 * Desktop-app dispatch primitive: fill the chat box and highlight it for the
 * user to review. NEVER sends — the send action is always the user's own
 * Enter / click on the site's send button (compliance: no programmatic sends).
 */
export function fillAndSendAgent(text: string): { ok: boolean; sent: boolean; error?: string; pendingConfirm?: boolean } {
  const filled = fillChatBox(text, CHAT_INPUT_SELECTORS);
  if (!filled) return { ok: false, sent: false, error: '未找到聊天输入框' };
  highlightChatInput();
  return { ok: true, sent: false, pendingConfirm: true };
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
 * Shared fill routine. Auto-send was removed for compliance: the extension
 * fills + highlights the chat box and the user confirms before sending
 * (their own Enter / click on the site's send button). If no chat input
 * exists yet, tries to OPEN the chat window itself by clicking the site's
 * 立即沟通 button, then retries filling.
 */
export async function fillPitch(
  pitch: string,
  // _autoSend kept only for call-site compatibility (always manual now).
  _autoSend?: boolean,
  back?: () => void,
  // _board kept for call-site compatibility; board auto-log on send no longer
  // applies because the extension never sends.
  _board?: { company: string; title: string; url?: string },
): Promise<void> {
  const filled = fillChatBox(pitch, CHAT_INPUT_SELECTORS);
  if (!filled) {
    const opened = clickOpenChatButton();
    if (opened) {
      showPanel({
        state: 'tagging',
        title: 'TomiHunt',
        rows: ['已帮你点击「立即沟通」打开聊天窗口…'],
        pitch,
      });
      for (let i = 0; i < 6; i += 1) {
        await new Promise((r) => setTimeout(r, 800));
        if (fillChatBox(pitch, CHAT_INPUT_SELECTORS)) {
          highlightChatInput();
          showPanel({
            title: 'TomiHunt',
            rows: ['✅ 已填入聊天框并高亮。请确认内容后，在聊天页按 Enter 或点击发送。'],
            pitch,
            actions: back ? [{ label: '返回', onClick: back }] : [],
          });
          return;
        }
      }
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
  highlightChatInput();
  showPanel({
    title: 'TomiHunt',
    rows: ['✅ 已填入聊天框并高亮。请确认内容后，在聊天页按 Enter 或点击发送。'],
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
  const epoch = viewEpoch; // a score for a job the user already left stays silent
  if (!isViewCurrent(epoch)) return;
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
    if (!isViewCurrent(epoch)) return; // switched jobs while the LLM ran — no stale paint
    showPanel({
      title: `${panelTitle} — 匹配度`,
      rows,
      feedback: { feature: 'match' },
      actions: [
        // High fit ⇒ straight to the pitch, no navigation detour.
        ...(result.score >= 85
          ? [{ label: '生成打招呼语', onClick: () => void generatePitch(ctx, panelTitle), primary: true }]
          : []),
        { label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    if (!isViewCurrent(epoch)) return; // superseded errors stay silent
    if (isContextInvalidated(err)) {
      contextInvalidatedPanel(panelTitle);
      return;
    }
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `打分失败: ${(err as Error).message}`,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  }
}

export async function showInterviewPrep(ctx: CapturedContext, panelTitle: string): Promise<void> {
  const epoch = viewEpoch; // prep for a job the user already left stays silent
  if (!isViewCurrent(epoch)) return;
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
    if (!isViewCurrent(epoch)) return; // switched jobs while the LLM ran — no stale paint
    showPanel({
      title: `${panelTitle} — 面试准备`,
      rows,
      actions: [{ label: '返回', onClick: () => showTaggedPanel(ctx, panelTitle) }],
    });
  } catch (err) {
    if (!isViewCurrent(epoch)) return; // superseded errors stay silent
    if (isContextInvalidated(err)) {
      contextInvalidatedPanel(panelTitle);
      return;
    }
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
