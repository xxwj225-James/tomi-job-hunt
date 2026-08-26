/**
 * Boss直聘 chat page (zhipin.com/web/geek/chat/*).
 *
 * 立即沟通 on the job detail page navigates here (SPA route). This script
 * reads the pitch stored by the detail page from chrome.storage.session and
 * offers one-click fill — or auto-sends it when the user chose the auto
 * send mode in the options page. The chat box is a contenteditable div,
 * not a textarea (verified via live research, 2026-08).
 */
import { fillPitch, getSendMode, showPanel } from './shared.js';

function main(): void {
  void (async () => {
    const { loadPitch } = await import('./shared.js');
    const stored = await loadPitch();
    if (!stored) return;

    if ((await getSendMode()) === 'auto') {
      // Auto mode: fill + send right away; the panel reports what happened.
      await fillPitch(stored.pitch, true);
      return;
    }

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
