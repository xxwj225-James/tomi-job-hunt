/**
 * Boss直聘 risk-control ("安全验证") detection.
 *
 * A challenge belongs to the ACCOUNT/SESSION, not to one page: once BOSS
 * decides a session looks automated it puts a slider wall in front of the whole
 * site until the user clears it. So every content script asks this module
 * first and goes quiet while the wall is up — no extraction, no silent imports,
 * no API calls. Two reasons:
 *   1. anything we do while challenged (especially another API request) is
 *      exactly the signal that deepens it;
 *   2. the wall's own text ("请完成安全验证…") would otherwise be extracted and
 *      deposited into the JD library as if it were a job posting.
 *
 * Detection is blunt but narrow: every signal below appears on the wall and
 * nowhere in normal browsing. A false positive costs the user a paused
 * extension until reload; a false negative costs a garbage JD record plus
 * another request into an already-challenged session.
 */
import { showPanel } from './shared.js';

/** The wall's own URL is the strongest signal (no DOM needed). */
const URL_PATTERNS = [/security-check/i, /security_check/i, /\/web\/common\/verify/i, /\bcaptcha\b/i];
/** Slider/widget containers used by BOSS's verification pages. */
const SELECTORS = ['.geetest_holder', '.geetest_panel', '.verify-wrap', '.security-check', '#captcha-wrap'];
/** Phrases that only ever appear on the wall itself. */
const TEXT_MARKERS = ['请完成安全验证', '拖动滑块', '访问过于频繁', '当前账号存在异常', '为保障您的账号安全'];

/** True when this document is BOSS's verification wall, not a job page. */
export function isChallengePage(doc: Document): boolean {
  const href = doc.location?.href ?? doc.URL ?? '';
  if (URL_PATTERNS.some((re) => re.test(href))) return true;
  if (SELECTORS.some((sel) => doc.querySelector(sel))) return true;
  // textContent, not innerText: no layout work on a 2s poll, and hidden nodes
  // cannot fake a phrase this specific.
  const text = doc.body?.textContent?.slice(0, 20_000) ?? '';
  return TEXT_MARKERS.some((m) => text.includes(m));
}

/** What we tell the user — this is BOSS's decision, not a TomiHunt failure. */
let challengePanelShown = false;

export function showChallengePanel(): void {
  if (challengePanelShown) return; // every 2s poll would otherwise re-pop it
  challengePanelShown = true;
  showPanel({
    state: 'error',
    title: 'TomiHunt · 已暂停',
    rows: [
      'BOSS直聘 弹出了「安全验证」——这是网站的风控判断（短时间浏览过多岗位、或账号环境异常），不是插件出错。',
      '插件已暂停采集与入库，本会话不再调用 BOSS 的岗位接口。请手动完成验证；验证通过后刷新页面即可恢复。',
    ],
    actions: [{ label: '🔄 我已通过验证，刷新页面', onClick: () => location.reload(), primary: true }],
  });
}

/** Test seam — the shown-once latch is module state. */
export function resetChallengePanel(): void {
  challengePanelShown = false;
}
