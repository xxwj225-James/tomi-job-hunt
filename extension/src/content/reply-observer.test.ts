// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeChatMessages } from './shared.js';

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('observeChatMessages', () => {
  it('fires for a newly added incoming message and not for my own', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));

    const chat = document.createElement('div');
    chat.id = 'chat';
    document.body.appendChild(chat);

    const incoming = document.createElement('div');
    incoming.className = 'chat-message from';
    incoming.textContent = '方便面试吗？';
    chat.appendChild(incoming);

    const mine = document.createElement('div');
    mine.className = 'chat-message self';
    mine.textContent = '好的，我明天有空';
    chat.appendChild(mine);

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual(['方便面试吗？']);
    stop();
  });

  it('dedupes identical messages', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));
    const chat = document.createElement('div');
    document.body.appendChild(chat);

    for (let i = 0; i < 3; i += 1) {
      const el = document.createElement('div');
      el.className = 'chat-message from';
      el.textContent = '同一句话';
      chat.appendChild(el);
    }

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual(['同一句话']);
    stop();
  });
});
