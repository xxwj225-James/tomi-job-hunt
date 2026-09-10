/**
 * Boss直聘 chat page (zhipin.com/web/geek/chat/*).
 *
 * 立即沟通 on the job detail page navigates here (SPA route). This script reads
 * the pitch stored by the detail page from chrome.storage.session and offers
 * one-click fill — the extension never sends on the user's behalf (compliance).
 * The chat box is a contenteditable div, not a textarea (verified via live
 * research, 2026-08).
 *
 * It also REGISTERS this tab with the desktop app's gateway as the fill target
 * for its job (`jd:<jobUid>`). That registration used to sit behind `if (stored)
 * return` — a stored pitch — which broke the app's own flow: the app writes the
 * greeting itself and dispatches it over the gateway, so no extension-side pitch
 * ever existed, no session was ever registered, and every 填入聊天框 buffered
 * for 30s and failed as "插件未上线/窗口离线超时" while the extension was in
 * fact connected (verified: agents=1, sessions=0).
 */
import { fillPitch, loadLastJd, loadPitch, showPanel, watchChatForReplies } from './shared.js';
import { computeJobUid, installAgentClient, reportSession } from './agent-client.js';
import { isChallengePage } from './challenge.js';

/** The job this chat page is about. */
export interface ChatIdentity {
  company: string;
  title: string;
}

/**
 * How long "the JD the user was just looking at" stays usable as identity.
 * 立即沟通 navigates within seconds; ten minutes is generous for that hop while
 * still refusing a job the user left long ago.
 */
const LAST_JD_MAX_AGE_MS = 10 * 60_000;

/**
 * BOSS masks some employers ("某大型上市公司", "某互联网公司") — a name that can
 * never be found in page text, so matching on it would refuse every such job and
 * re-create the very bug this function fixes.
 */
function isMaskedCompany(company: string): boolean {
  return company.length < 2 || company.includes('某');
}

/** The most distinguishing string a JD can be recognized by on a page. */
function matchToken(company: string, title: string): string {
  // Company discriminates best; a masked name is not matchable at all, so
  // those fall back to the — weaker, but at least present — job title.
  return isMaskedCompany(company) ? title : company;
}

/** True when this page's text is consistent with the given job. */
function pageShows(pageText: string, company: string, title: string): boolean {
  if (!pageText) return true; // nothing to check against — do not guess a refusal
  const token = matchToken(company, title);
  return token.length >= 2 && pageText.includes(token);
}

/**
 * The job this chat page belongs to.
 *
 * Order: the stored pitch (generated FOR a specific job), else the last JD
 * shown in this browser session. Both are checked against the page, because a
 * wrong identity makes the app fill a greeting into the wrong conversation —
 * and because Boss swaps conversations inside the chat SPA without a reload,
 * which would otherwise strand this tab's registration on whichever job was
 * current when the page loaded. Freshness bounds how long a stale job can leak
 * in at all. Two postings at the SAME company inside that window can still
 * collide — the app never sends on the user's behalf, so the worst case is a
 * greeting the user sees and clears.
 */
export async function chatJobIdentity(pageText: string, now = Date.now()): Promise<ChatIdentity | null> {
  const pitch = await loadPitch();
  if (pitch && pageShows(pageText, (pitch.company ?? '').trim(), pitch.jdTitle)) {
    return { company: (pitch.company ?? '').trim(), title: pitch.jdTitle };
  }

  const last = await loadLastJd();
  if (!last || now - last.at > LAST_JD_MAX_AGE_MS) return null;
  const company = (last.jd.company ?? '').trim();
  const title = (last.jd.title ?? '').trim();
  if (!pageShows(pageText, company, title)) return null;
  return { company, title };
}

/** Poll interval for SPA conversation switches (see syncRegistration). */
const ROUTE_POLL_MS = 2_000;

function main(): void {
  // Headless agent: accept desktop-app dispatch commands (fill + highlight).
  installAgentClient();
  // Smart replies: incoming HR messages draft a reply into the chat box
  // (the user always sends it themselves).
  watchChatForReplies();

  /** The target this tab is currently registered as — null when unregistered. */
  let registered: string | null = null;

  /**
   * Registers, re-registers or drops this tab's session so it always names the
   * conversation actually on screen.
   *
   * Boss switches conversations inside the chat SPA without a reload, so a
   * registration made at page load goes stale the moment the user picks another
   * conversation. Stale is not benign here: sessions stay "online" for as long
   * as the extension is connected, so the app would keep dispatching JD A's
   * greeting into whatever conversation the tab now shows. Re-deriving on change
   * turns that into a plain "聊天窗口离线" instead.
   */
  async function syncRegistration(): Promise<void> {
    // A verification wall replaces the chat: drop whatever this tab had
    // registered — the app must show 离线 rather than fill into a wall.
    if (isChallengePage(document)) {
      if (registered) {
        void reportSession('remove', registered);
        registered = null;
      }
      return;
    }
    const identity = await chatJobIdentity(document.body?.innerText ?? '');
    const next = identity ? `jd:${await computeJobUid(identity.company, identity.title)}` : null;
    if (next === registered) return;
    if (registered) void reportSession('remove', registered);
    if (next) void reportSession('upsert', next);
    registered = next;
  }

  void syncRegistration();
  // Polled rather than event-driven: Boss's SPA navigates via pushState (no
  // popstate) and may still be hydrating the conversation when this script
  // first runs, so an install-time call alone can find no identity at all.
  // syncRegistration itself is cheap and idempotent — it only reports on change.
  window.setInterval(() => void syncRegistration(), ROUTE_POLL_MS);

  // Re-announce whenever the background SW wakes up and asks chat tabs to
  // re-sync (covers SW restarts where the session map was lost).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'tomi-session-sync') {
      void syncRegistration();
    }
    return undefined;
  });
  // Leaving/closing the chat tab drops the session on the gateway.
  window.addEventListener('pagehide', () => {
    if (registered) void reportSession('remove', registered);
  });

  void (async () => {
    // The floating panel exists to offer a pitch, so it is gated on the pitch
    // alone — independent of registration above, which must be free to refuse a
    // job the page does not back up. A wall has no chat box to fill, though.
    if (isChallengePage(document)) return;
    const stored = await loadPitch();
    if (!stored) return;
    showPanel({
      title: 'TomiHunt · 打招呼语已就绪',
      rows: [`岗位: ${stored.jdTitle}`],
      pitch: stored.pitch,
      actions: [
        {
          label: '填入聊天框',
          onClick: () => void fillPitch(stored.pitch),
          primary: true,
        },
      ],
    });
  })();
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
