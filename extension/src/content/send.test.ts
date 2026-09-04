// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { clickOpenChatButton, highlightChatInput, fillAndSendAgent } from './shared.js';

function installDom(html: string): Document {
  const dom = new JSDOM(html);
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return dom.window.document;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  vi.restoreAllMocks();
});

describe('fillAndSendAgent (compliance: never sends)', () => {
  it('fills the chat box, highlights it, and reports pendingConfirm — never sends', () => {
    const doc = installDom(
      `<html><body><div class="chat-input" contenteditable="true"></div><button class="btn-send" style="display:block">发送</button></body></html>`,
    );
    const result = fillAndSendAgent('你好，我是……');
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(false);
    expect(result.pendingConfirm).toBe(true);
    // text was filled
    expect(doc.querySelector('.chat-input')!.textContent).toContain('你好');
  });

  it('reports ok:false when no chat input exists', () => {
    installDom(`<html><body></body></html>`);
    const result = fillAndSendAgent('你好');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('highlightChatInput', () => {
  it('applies an outline then clears it after 6s', () => {
    vi.useFakeTimers();
    try {
      const doc = installDom(`<html><body><div class="chat-input" contenteditable="true"></div></body></html>`);
      highlightChatInput();
      const el = doc.querySelector('.chat-input') as HTMLElement;
      expect(el.style.outline).toContain('2px solid');
      vi.advanceTimersByTime(6500);
      expect(el.style.outline).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('clickOpenChatButton', () => {
  it('clicks a 聊一聊 button (liepin)', () => {
    const doc = installDom(`<html><body><button class="im-chat-btn">聊一聊</button></body></html>`);
    const btn = doc.querySelector('button')!;
    let clicked = false;
    btn.addEventListener('click', () => { clicked = true; });
    expect(clickOpenChatButton()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('ignores long paragraphs even if they contain 沟通', () => {
    const doc = installDom(`<html><body><div role="button">这是一个很长的沟通段落说明文字超过十二个字</div></body></html>`);
    let clicked = false;
    doc.querySelector('[role="button"]')!.addEventListener('click', () => { clicked = true; });
    expect(clickOpenChatButton()).toBe(false);
    expect(clicked).toBe(false);
  });
});
