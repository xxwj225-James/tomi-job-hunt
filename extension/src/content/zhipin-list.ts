/**
 * Boss直聘 search list page (zhipin.com/web/geek/job*):
 * Phase 3 — noise reduction + on-demand AI scoring.
 *
 * 1. Rule hard-filter: cards carrying risk keywords are greyed out with a
 *    TomiHunt badge (外包/驻场/单休/大小周/试用期不交社保/薪资虚高)
 * 2. Hover a card → small 🤖 button → capture the card summary, score it
 *    against the local resume via /v1/match → score badge on the card
 *    (lazy + cost-controlled: only cards the user asks about)
 */
import { CORE_BASE, getCoreBase } from '../core-client.js';
import { client, showPanel } from './shared.js';
import { isChallengePage, showChallengePanel } from './challenge.js';
import type { JdCaptureInput } from '../types.js';

const RISK_KEYWORDS = ['外包', '驻场', '人力外包', '劳务派遣', '单休', '大小周', '试用期不交社保', '996'];

const CARD_SELECTORS = ['.job-card-wrapper', '.job-list-box li', '.job-card-body'];

export interface ListCard {
  el: Element;
  title: string;
  company: string;
  salaryText: string;
  brief: string;
}

/** Extracts a lightweight JD summary from a list card (no full JD available). */
export function extractCard(card: Element): ListCard | null {
  const title = card.querySelector('.job-name')?.textContent?.trim() || '';
  const company = card.querySelector('.company-name')?.textContent?.trim() || '';
  if (!title && !company) return null;
  const salaryText = card.querySelector('.salary')?.textContent?.trim() || '';
  // Longest text block inside THIS card (tags / footer / description)
  let brief = '';
  for (const sel of ['.tag-list', '.job-card-footer', '.job-card-body .info-desc']) {
    for (const el of card.querySelectorAll(sel)) {
      const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > brief.length) brief = text;
    }
  }
  return { el: card, title, company, salaryText, brief };
}

function badge(text: string, bg: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  Object.assign(span.style, {
    position: 'absolute',
    top: '8px',
    right: '8px',
    zIndex: '9999',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#fff',
    background: bg,
    pointerEvents: 'none' as string,
  });
  return span;
}

/** Marks a card already greyed + badged (indexed cards only). */
const FILTERED_ATTR = 'data-tomihunt-filtered';

/**
 * Greys out and badges risky cards, once per card. Returns the CUMULATIVE
 * number of flagged cards.
 *
 * The once-per-card part matters: the tick re-scans every 5s, and this used to
 * append a fresh badge (and re-pop the panel) on every pass — a card quickly
 * carried dozens of stacked badges, and the page saw a DOM-mutation storm for
 * as long as 2.5 minutes. Extra injected nodes are also the most script-like
 * thing we do on a page BOSS is actively risk-scoring.
 */
export function applyHardFilters(cards: ListCard[]): number {
  let flagged = 0;
  for (const card of cards) {
    const html = card.el as HTMLElement;
    if (html.getAttribute(FILTERED_ATTR) === '1') {
      flagged += 1;
      continue;
    }
    const text = `${card.title} ${card.company} ${card.salaryText} ${card.brief}`;
    const hit = RISK_KEYWORDS.find((kw) => text.includes(kw));
    if (!hit) continue;
    html.setAttribute(FILTERED_ATTR, '1');
    html.style.opacity = '0.35';
    html.style.filter = 'grayscale(0.8)';
    html.style.position = 'relative';
    html.appendChild(badge(`TomiHunt 降噪: ${hit}`, '#8a8f98'));
    flagged += 1;
  }
  return flagged;
}

const HOVER_BTN_ATTR = 'data-tomihunt-scorer';

/**
 * Injects the 🤖 scoring button on HOVER, and only then.
 *
 * It used to be injected into every card on every 5s scan, which made the
 * extension the single largest source of added DOM on a page BOSS risk-scores
 * (and left a button on every card for the whole session). Now a card gains
 * exactly one node while the pointer is on it, and loses it on mouseout.
 */
export function attachScoreHover(doc: Document = document): void {
  const cardOf = (target: EventTarget | null): HTMLElement | null => {
    const el = target instanceof Element ? target.closest(CARD_SELECTORS.join(',')) : null;
    return el instanceof HTMLElement ? el : null;
  };

  doc.addEventListener(
    'mouseover',
    (e) => {
      const html = cardOf(e.target);
      if (!html || html.querySelector(`[${HOVER_BTN_ATTR}]`)) return;
      if (html.getAttribute('data-tomihunt-scored') === '1') return; // already scored
      const card = extractCard(html);
      if (!card) return;
      html.appendChild(makeScoreButton(card, html));
    },
    true,
  );

  doc.addEventListener(
    'mouseout',
    (e) => {
      const html = cardOf(e.target);
      // Only when the pointer left the card entirely (not card → child).
      if (!html || (e.relatedTarget instanceof Node && html.contains(e.relatedTarget))) return;
      html.querySelector(`[${HOVER_BTN_ATTR}]`)?.remove();
    },
    true,
  );
}

function makeScoreButton(card: ListCard, host: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = '🤖';
  btn.title = 'TomiHunt AI 打分';
  btn.setAttribute(HOVER_BTN_ATTR, '1');
  Object.assign(btn.style, {
    position: 'absolute',
    bottom: '8px',
    right: '8px',
    zIndex: '9999',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    border: '0',
    cursor: 'pointer',
    fontSize: '14px',
    background: 'linear-gradient(135deg, #4f7cff, #6a5cff)',
    boxShadow: '0 2px 8px rgba(80,90,220,.35)',
  });
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    void scoreCard(card, btn);
  };
  host.style.position = 'relative';
  return btn;
}

async function scoreCard(card: ListCard, btn: HTMLButtonElement): Promise<void> {
  if (!card.title || !card.company) {
    showPanel({ state: 'error', title: 'TomiHunt 打分', rows: [], error: '该卡片信息不足，无法打分' });
    return;
  }
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const jd: JdCaptureInput = {
      source: 'zhipin',
      url: window.location.href,
      title: card.title,
      company: card.company,
      salaryText: card.salaryText,
      requirements: card.brief,
    };
    const base = (await getCoreBase()) ?? CORE_BASE;
    const resp = await fetch(`${base}/v1/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${resp.status}`);
    const result = (await resp.json()) as { score: number; verdict: string };
    const color = result.score >= 80 ? '#1a7f37' : result.score >= 60 ? '#b25e00' : '#8a8f98';
    card.el.appendChild(badge(`${result.score}分·${result.verdict}`, color));
    const html = card.el as HTMLElement;
    html.dataset.tomihuntScored = '1';
  } catch (err) {
    showPanel({
      state: 'error',
      title: 'TomiHunt 打分',
      rows: [],
      error: `打分失败（Core 服务在线吗？）: ${(err as Error).message}`,
    });
  } finally {
    btn.remove();
  }
}

function collectCards(doc: Document): ListCard[] {
  const seen = new Set<Element>();
  const cards: ListCard[] = [];
  for (const sel of CARD_SELECTORS) {
    for (const el of doc.querySelectorAll(sel)) {
      if (seen.has(el)) continue;
      seen.add(el);
      const card = extractCard(el);
      if (card) cards.push(card);
    }
  }
  return cards;
}

export function main(): void {
  // A verification wall is not a job list: nothing here applies, and injecting
  // into a page BOSS has flagged is the worst possible time to do it.
  if (isChallengePage(document)) {
    showChallengePanel();
    return;
  }
  const cards = collectCards(document);
  if (cards.length === 0) return; // not a list page / SPA not rendered yet
  let reported = 0;
  // Only speak up when the flagged count GROWS — the panel used to re-pop on
  // every 5s tick, for as long as any risky card stayed on screen.
  const announce = (flagged: number): void => {
    if (flagged <= reported) return;
    reported = flagged;
    showPanel({
      title: 'TomiHunt 列表页降噪',
      rows: [
        `已降噪 ${flagged} 个风险岗位卡片（外包/单休/驻场等规则过滤）。`,
        '鼠标移到任意卡片上，点 🤖 可 AI 打分。',
      ],
      actions: [{ label: '知道了', onClick: () => undefined }],
    });
  };
  attachScoreHover(document);
  announce(applyHardFilters(cards));
  // SPA infinite-scroll appends cards — rescan periodically
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const fresh = collectCards(document);
    announce(applyHardFilters(fresh));
    if (ticks > 30) clearInterval(timer); // stop after ~2.5 min
  }, 5000);
  void client;
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
