// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHardFilters, attachScoreHover, extractCard, main } from './zhipin-list.js';
import { resetChallengePanel } from './challenge.js';

const RISKY_CARD = `
  <div class="job-card-wrapper">
    <span class="job-name">前端工程师</span>
    <span class="company-name">某科技有限公司</span>
    <span class="salary">10-15K</span>
    <div class="tag-list">外包 单休 五险一金</div>
  </div>`;

const CLEAN_CARD = `
  <div class="job-card-wrapper">
    <span class="job-name">高级后端工程师</span>
    <span class="company-name">某某科技</span>
    <span class="salary">25-40K</span>
    <div class="tag-list">双休 六险一金</div>
  </div>`;

/**
 * Uses the environment's own jsdom document rather than a fresh `new JSDOM()`:
 * the production code checks `target instanceof Element`, and elements from a
 * separately constructed JSDOM live in another realm where that check is false
 * no matter what they are.
 */
function installDom(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

function card(doc: Document): Element {
  return doc.querySelector('.job-card-wrapper')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetChallengePanel();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('applyHardFilters', () => {
  it('greys and badges a risky card once', () => {
    const doc = installDom(`<body>${RISKY_CARD}</body>`);
    const el = card(doc) as HTMLElement;

    const flagged = applyHardFilters([extractCard(el)!]);

    expect(flagged).toBe(1);
    expect(el.style.opacity).toBe('0.35');
    expect(el.textContent).toContain('TomiHunt 降噪');
  });

  it('does not stack a second badge when the 5s tick rescans', () => {
    // The bug: applyHardFilters ran on every tick and appended a fresh badge
    // each pass, so a card carried dozens of stacked nodes within 2.5 minutes.
    const doc = installDom(`<body>${RISKY_CARD}</body>`);
    const el = card(doc) as HTMLElement;
    const cards = [extractCard(el)!];

    applyHardFilters(cards);
    applyHardFilters(cards);
    applyHardFilters(cards);

    const badges = [...el.querySelectorAll('span')].filter((s) => s.textContent?.startsWith('TomiHunt 降噪'));
    expect(badges).toHaveLength(1);
  });

  it('keeps reporting the cumulative count so the panel can stay silent', () => {
    const doc = installDom(`<body>${RISKY_CARD}</body>`);
    const cards = [extractCard(card(doc))!];

    expect(applyHardFilters(cards)).toBe(1);
    expect(applyHardFilters(cards)).toBe(1); // unchanged → caller must not re-announce
  });

  it('leaves a clean card alone', () => {
    const doc = installDom(`<body>${CLEAN_CARD}</body>`);
    const el = card(doc) as HTMLElement;

    expect(applyHardFilters([extractCard(el)!])).toBe(0);
    expect(el.style.opacity).toBe('');
    expect(el.textContent).not.toContain('TomiHunt 降噪');
  });
});

describe('attachScoreHover', () => {
  it('injects the 🤖 button only while the pointer is on a card', () => {
    const doc = installDom(`<body>${CLEAN_CARD}</body>`);
    const el = card(doc) as HTMLElement;
    attachScoreHover(doc);

    // Nothing injected up front — that was the whole point.
    expect(el.querySelector('[data-tomihunt-scorer]')).toBeNull();

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(el.querySelector('[data-tomihunt-scorer]')).not.toBeNull();

    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: doc.body }));
    expect(el.querySelector('[data-tomihunt-scorer]')).toBeNull();
  });

  it('does not stack buttons when the pointer jitters inside one card', () => {
    const doc = installDom(`<body>${CLEAN_CARD}</body>`);
    const el = card(doc) as HTMLElement;
    attachScoreHover(doc);

    for (let i = 0; i < 5; i += 1) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    // Moving onto a child keeps the card hovered — the button must survive.
    el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: el.firstElementChild }));

    expect(el.querySelectorAll('[data-tomihunt-scorer]')).toHaveLength(1);
  });
});

describe('main', () => {
  it('does nothing on a verification wall', () => {
    const doc = installDom(`<body>${RISKY_CARD}<div class="geetest_holder"></div></body>`);
    const el = card(doc) as HTMLElement;

    main();

    expect(el.style.opacity).toBe(''); // no greying
    expect(el.getAttribute('data-tomihunt-filtered')).toBeNull();
    expect(el.querySelector('[data-tomihunt-scorer]')).toBeNull();
  });

  it('filters and arms hover scoring on a real list page', () => {
    const doc = installDom(`<body>${RISKY_CARD}${CLEAN_CARD}</body>`);
    main();

    expect((doc.querySelectorAll('.job-card-wrapper')[0] as HTMLElement).style.opacity).toBe('0.35');
    expect((doc.querySelectorAll('.job-card-wrapper')[1] as HTMLElement).style.opacity).toBe('');
  });
});
