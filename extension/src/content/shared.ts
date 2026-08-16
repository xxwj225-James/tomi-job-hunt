/**
 * Shared helpers for content scripts: resilient text extraction, an isolated
 * floating panel (shadow DOM), chat-box filling, and Core wiring.
 *
 * Anti-obfuscation notes (verified via live research, 2026-08):
 * - zhipin injects CSS-hidden interference words into JD/HR text — strip them
 * - the chat box is a contenteditable div (NOT a textarea) on /web/geek/chat
 */
import { CoreClient, CORE_BASE, formatTags } from '../core-client.js';
import type { JdCaptureInput, JdTags, GreetingResult } from '../types.js';

export const client = new CoreClient();

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
}): void {
  const rows = content.rows.map((r) => `<div class="row">${escapeHtml(r)}</div>`).join('');
  const tagsHtml = content.tags
    ? `<div class="tags">${escapeHtml(formatTags(content.tags))}</div>`
    : '';
  const pitchHtml = content.pitch ? `<div class="pitch">${escapeHtml(content.pitch)}</div>` : '';
  const spinner = content.state === 'tagging' ? '<span class="spinner"></span>' : '';
  const errorHtml = content.error ? `<div class="err">${escapeHtml(content.error)}</div>` : '';
  const actionsHtml =
    content.actions
      ?.map(
        (a) =>
          `<button class="btn ${a.primary === false ? 'secondary' : ''}" data-action="${a.label}">${escapeHtml(a.label)}</button>`,
      )
      .join('') ?? '';
  setPanelHtml(
    `<div class="h">${escapeHtml(content.title)}</div>${spinner}${rows}${tagsHtml}${pitchHtml}${errorHtml}<div style="margin-top:8px">${actionsHtml}</div>`,
  );
  const s = ensurePanel();
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

export async function captureAndShow(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在导入并分析 JD…'] });
  try {
    const { jobUid, taggingJobId } = await client.captureJd(ctx.jd);
    ctx.jobUid = jobUid;
    showPanel({ state: 'tagging', title: panelTitle, rows: ['已导入，等待 AI 结构化标签…'] });
    client.watch((event) => {
      if (event.type === 'jd/tagged' && event.jobId === taggingJobId) {
        ctx.tags = event.tags;
        if (event.tags) {
          showPanel({
            title: panelTitle,
            rows: [],
            tags: event.tags,
            actions: [
              { label: '生成打招呼语', onClick: () => void generatePitch(ctx, panelTitle), primary: true },
              { label: '匹配度打分', onClick: () => void showMatch(ctx, panelTitle) },
              { label: '准备面试', onClick: () => void showInterviewPrep(ctx, panelTitle) },
              { label: '加入看板', onClick: () => void addToBoard(ctx, panelTitle) },
              { label: '重新导入', onClick: () => void captureAndShow(ctx, panelTitle) },
            ],
          });
        } else {
          showPanel({ state: 'error', title: panelTitle, rows: [], error: `标签化失败: ${event.error ?? '未知错误'}` });
        }
      }
    });
  } catch (err) {
    showPanel({
      state: 'error',
      title: panelTitle,
      rows: [],
      error: `无法连接本地 Core 服务 (${CORE_BASE})。请确认已运行 npm run dev -w core。详情: ${(err as Error).message}`,
    });
  }
}

export async function generatePitch(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在生成打招呼语…'] });
  try {
    const result: GreetingResult = await client.greeting({
      jd: {
        title: ctx.jd.title,
        company: ctx.jd.company,
        salaryText: ctx.jd.salaryText,
        requirements: ctx.jd.requirements,
        hrName: ctx.jd.hrName,
      },
    });
    // Handoff: 立即沟通 navigates to /web/geek/chat/* — the chat page script
    // reads the pitch back from chrome.storage.session.
    await savePitch({ pitch: result.pitch, jdTitle: ctx.jd.title, ts: Date.now() });
    const rows = result.warning ? [result.warning] : [];
    showPanel({
      title: panelTitle,
      rows,
      pitch: result.pitch,
      actions: [
        { label: '填入聊天框', onClick: () => fillPitch(result.pitch), primary: true },
        { label: '重新生成', onClick: () => void generatePitch(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    showPanel({ state: 'error', title: panelTitle, rows: [], error: `生成失败: ${(err as Error).message}` });
  }
}

export function fillPitch(pitch: string): void {
  const filled = fillChatBox(pitch, [
    '.chat-input textarea',
    '.input-area textarea',
    '.message-input textarea',
    'textarea',
  ]);
  showPanel({
    title: 'TomiHunt',
    rows: filled ? ['✅ 已填入聊天框'] : ['未找到聊天框输入区 — 请先点击「立即沟通」打开聊天窗口，再点一次「填入聊天框」。'],
    pitch,
  });
}

// --- Phase 2/3 panel actions: match scoring + interview prep ---

export async function showMatch(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在计算匹配度（0-100）…'] });
  try {
    const resp = await fetch(`${CORE_BASE}/v1/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd: {
          title: ctx.jd.title,
          company: ctx.jd.company,
          salaryText: ctx.jd.salaryText,
          requirements: ctx.jd.requirements,
        },
      }),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    const result = (await resp.json()) as {
      score: number;
      verdict: string;
      strengths: string[];
      gaps: string[];
      risks: string[];
    };
    const rows = [
      `综合得分 ${result.score} 分 · ${result.verdict}`,
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
        { label: '返回', onClick: () => void captureAndShow(ctx, panelTitle) },
      ],
    });
  } catch (err) {
    showPanel({ state: 'error', title: panelTitle, rows: [], error: `打分失败: ${(err as Error).message}` });
  }
}

export async function addToBoard(ctx: CapturedContext, panelTitle: string): Promise<void> {
  try {
    const resp = await fetch(`${CORE_BASE}/v1/board`, {
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
      actions: [{ label: '返回', onClick: () => void captureAndShow(ctx, panelTitle) }],
    });
  } catch (err) {
    showPanel({ state: 'error', title: panelTitle, rows: [], error: `加入看板失败: ${(err as Error).message}` });
  }
}

export async function showInterviewPrep(ctx: CapturedContext, panelTitle: string): Promise<void> {
  showPanel({ state: 'tagging', title: panelTitle, rows: ['正在预测面试题…'] });
  try {
    const resp = await fetch(`${CORE_BASE}/v1/interview-prep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jd: {
          title: ctx.jd.title,
          company: ctx.jd.company,
          salaryText: ctx.jd.salaryText,
          requirements: ctx.jd.requirements,
        },
      }),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${resp.status}`);
    }
    const result = (await resp.json()) as {
      questions: Array<{ q: string; intent: string; starHint: string }>;
    };
    const rows = result.questions.flatMap((question, i) => [
      `Q${i + 1}. ${question.q}`,
      `  考察: ${question.intent}`,
      `  建议: ${question.starHint}`,
      '',
    ]);
    showPanel({
      title: `${panelTitle} — 面试准备`,
      rows,
      actions: [{ label: '返回', onClick: () => void captureAndShow(ctx, panelTitle) }],
    });
  } catch (err) {
    showPanel({ state: 'error', title: panelTitle, rows: [], error: `面试准备失败: ${(err as Error).message}` });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
