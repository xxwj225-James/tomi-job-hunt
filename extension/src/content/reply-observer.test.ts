// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fillChatBox, observeChatMessages } from './shared.js';

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

  it('does not fire for an echo of text the extension itself filled (self-sent)', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));

    // The extension fills its reply into the chat box (e.g. liepin).
    document.body.innerHTML = '<textarea class="chat-input"></textarea>';
    const filled = fillChatBox('我明天有空，方便的话约个时间', ['textarea.chat-input']);
    expect(filled).toBe(true);

    // The sent message echoes back into the DOM with NO side marker (liepin
    // markup carries no self/right class) — must NOT be treated as incoming.
    const chat = document.createElement('div');
    document.body.appendChild(chat);
    const echo = document.createElement('div');
    echo.className = 'chat-message';
    echo.textContent = '我明天有空，方便的话约个时间';
    chat.appendChild(echo);

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([]);
    stop();
  });

  it('does not fire when liepin echoes a single line of a multi-line filled message', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));

    // A greeting pitch is multi-line; liepin renders it as per-line bubbles.
    document.body.innerHTML = '<textarea class="chat-input"></textarea>';
    fillChatBox('您好，看到贵司在招高级后端工程师，想和您沟通。\n我有多年前后端经验，熟悉 Java/Go/Redis。', [
      'textarea.chat-input',
    ]);

    const chat = document.createElement('div');
    document.body.appendChild(chat);
    // Echo of just the first line, no self/right side marker.
    const lineBubble = document.createElement('div');
    lineBubble.className = 'chat-message';
    lineBubble.textContent = '您好，看到贵司在招高级后端工程师，想和您沟通。';
    chat.appendChild(lineBubble);

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([]);
    stop();
  });

  it('does not fire for MY message marked by layout (margin-left:auto right-aligned)', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));

    const chat = document.createElement('div');
    document.body.appendChild(chat);
    const mine = document.createElement('div');
    mine.className = 'chat-message'; // no self/right class — liepin-style
    mine.style.marginLeft = 'auto'; // flex auto-margin pushes my bubble right
    mine.textContent = '您好，看到贵司的岗位，想沟通一下';
    chat.appendChild(mine);

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([]);
    stop();
  });

  it('fires for an incoming message marked by layout (margin-right:auto left-aligned)', async () => {
    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));

    const chat = document.createElement('div');
    document.body.appendChild(chat);
    const theirs = document.createElement('div');
    theirs.className = 'chat-message'; // no left/from class — liepin-style
    theirs.style.marginRight = 'auto'; // flex auto-margin pushes their bubble left
    theirs.textContent = '方便的话，明天下午面试可以吗？';
    chat.appendChild(theirs);

    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual(['方便的话，明天下午面试可以吗？']);
    stop();
  });
});
