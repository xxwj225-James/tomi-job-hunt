/**
 * Boss直聘 chat page (zhipin.com/web/geek/chat/*).
 *
 * 立即沟通 on the job detail page navigates here (SPA route). This script
 * reads the pitch stored by the detail page from chrome.storage.session and
 * offers one-click fill into the chat box — which is a contenteditable div,
 * not a textarea (verified via live research, 2026-08).
 */
import { fillChatBox, loadPitch, showPanel } from './shared.js';

// Current chat-input selector chain (from active userscript, 2026-08).
const CHAT_INPUT_SELECTORS = [
  '#chat-input.chat-input[contenteditable="true"]',
  '.chat-input[contenteditable="true"]',
  '.chat-input',
  'textarea',
  '[contenteditable="true"]',
];

function main(): void {
  void loadPitch().then((stored) => {
    if (!stored) return;
    showPanel({
      title: 'TomiHunt · 打招呼语已就绪',
      rows: [`岗位: ${stored.jdTitle}`],
      pitch: stored.pitch,
      actions: [
        {
          label: '填入聊天框',
          onClick: () => {
            const filled = fillChatBox(stored.pitch, CHAT_INPUT_SELECTORS);
            showPanel({
              title: 'TomiHunt',
              rows: filled
                ? ['✅ 已填入，确认后按 Enter 发送']
                : ['未找到聊天输入框 — 请等聊天窗口完全加载后再试。'],
              pitch: stored.pitch,
              actions: [
                { label: '再试一次', onClick: () => fillChatBox(stored.pitch, CHAT_INPUT_SELECTORS) },
              ],
            });
          },
          primary: true,
        },
      ],
    });
  });
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') main();
