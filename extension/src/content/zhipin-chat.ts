/**
 * Boss直聘 chat page (zhipin.com/web/geek/chat/*).
 *
 * 立即沟通 on the job detail page navigates here (SPA route). This script
 * reads the pitch stored by the detail page from chrome.storage.session and
 * offers one-click fill — the extension never sends on the user's behalf
 * (compliance). The chat box is a contenteditable div, not a textarea
 * (verified via live research, 2026-08).
 */
import { fillPitch, loadPitch, showPanel, watchChatForReplies } from './shared.js';
import { computeJobUid, installAgentClient, reportSession } from './agent-client.js';

function main(): void {
  // Headless agent: accept desktop-app dispatch commands (fill + highlight).
  installAgentClient();
  // Smart replies: incoming HR messages draft a reply into the chat box
  // (the user always sends it themselves).
  watchChatForReplies();
  void (async () => {
    const stored = await loadPitch();
    if (!stored) return;

    // Register this tab as the chat session for that JD — same jobUid the
    // desktop app computes, so it sees this tab online and dispatches sends
    // to us. The SW stamps sender.tab.id and forwards to the gateway.
    const targetId = `jd:${await computeJobUid(stored.company ?? '', stored.jdTitle)}`;
    void reportSession('upsert', targetId);
    // Re-announce whenever the background SW wakes up and asks chat tabs to
    // re-sync (covers SW restarts where the session map was lost).
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && typeof msg === 'object' && (msg as { type?: string }).type === 'tomi-session-sync') {
        void reportSession('upsert', targetId);
      }
      return undefined;
    });
    // Leaving/closing the chat tab drops the session on the gateway.
    window.addEventListener('pagehide', () => void reportSession('remove', targetId), { once: true });

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
