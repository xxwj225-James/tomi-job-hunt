// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { observeChatMessages } from './shared.js';

function installDom(html: string): Document {
  const dom = new JSDOM(html);
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  (globalThis as { MutationObserver?: unknown }).MutationObserver = dom.window.MutationObserver;
  return dom.window.document;
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('observeChatMessages', () => {
  it('fires for a newly added incoming message and not for my own', () => {
    const doc = installDom(`<html><body><div id="chat"></div></body></html>`);
    const stop = observeChatMessages((text) => {
      received.push(text);
    });
    const received: string[] = [];
    const chat = doc.getElementById('chat')!;

    const incoming = doc.createElement('div');
    incoming.className = 'chat-message from';
    incoming.textContent = '方便面试吗？';
    chat.appendChild(incoming);

    const mine = doc.createElement('div');
    mine.className = 'chat-message self';
    mine.textContent = '好的，我明天有空';
    chat.appendChild(mine);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(received).toEqual(['方便面试吗？']);
        stop();
        resolve();
      }, 20);
    });
  });
});
