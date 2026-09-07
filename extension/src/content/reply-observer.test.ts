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

  it('never guesses on UNMARKED history already on screen (page reload mid-chat)', async () => {
    // Chat with our own past message BEFORE the observer attaches — liepin
    // renders every bubble without a side marker, so on a reload this used to
    // fire a spurious "incoming" for OUR OWN old message.
    const chat = document.createElement('div');
    const own = document.createElement('div');
    own.className = 'chat-message'; // no side marker — could be mine
    own.textContent = '您好，我之前主动投递了这个岗位';
    chat.appendChild(own);
    document.body.appendChild(chat);

    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual([]); // unmarked backlog must not fire
    stop();
  });

  it('fires for history the markup clearly marks as the other side', async () => {
    const chat = document.createElement('div');
    const theirs = document.createElement('div');
    theirs.className = 'chat-message from'; // positive "other side" marker
    theirs.textContent = '方便的话加个微信？';
    chat.appendChild(theirs);
    const own = document.createElement('div');
    own.className = 'chat-message self'; // clearly mine — never fires
    own.textContent = '好的，我的微信号是 xxx';
    chat.appendChild(own);
    document.body.appendChild(chat);

    const received: string[] = [];
    const stop = observeChatMessages((text) => received.push(text));
    await new Promise((r) => setTimeout(r, 30));
    expect(received).toEqual(['方便的话加个微信？']);
    stop();
  });

  it('treats a delayed echo of our fill as outgoing, even >90s after the fill (Agent review gap)', async () => {
    vi.useFakeTimers();
    try {
      // The Agent fills a pitch; the user reviews it in the desktop app for a
      // couple of minutes, THEN presses send in the browser. The echo arrives
      // long past the old 90s window — it must still not be "incoming".
      document.body.innerHTML = '<textarea class="chat-input"></textarea>';
      const filled = fillChatBox('您好，想和您确认一下面试时间的安排', ['textarea.chat-input']);
      expect(filled).toBe(true);
      vi.advanceTimersByTime(2 * 60_000);

      const received: string[] = [];
      const stop = observeChatMessages((text) => received.push(text));

      const chat = document.createElement('div');
      document.body.appendChild(chat);
      const echo = document.createElement('div');
      echo.className = 'chat-message'; // no side marker — liepin
      echo.textContent = '您好，想和您确认一下面试时间的安排';
      chat.appendChild(echo);
      // Control: an unrelated unmarked NEW message must still fire — this
      // proves the observer is live and only the echo was suppressed.
      // (Appended as its own node: the observer scans each added node.)
      const real = document.createElement('div');
      real.className = 'chat-message';
      real.textContent = '请问您目前还在职吗？';
      chat.appendChild(real);

      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      // Both the suppressed echo and the control are UNMARKED bubbles, so each
      // is held ~250ms to give a just-cleared send time to register as outgoing
      // before firing (see observeChatMessages / trackChatInputSends).
      vi.advanceTimersByTime(400);
      expect(received).toEqual(['请问您目前还在职吗？']);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
