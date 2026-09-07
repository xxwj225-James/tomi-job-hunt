// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { installLiepinAgentClient, readChatCounterpart, registerChatSession } from './liepin.js';

/** chrome.runtime.onMessage listeners captured by the liepin chat wiring. */
type Listener = (msg: unknown) => void;
let listeners: Listener[] = [];
let sentMessages: Array<Record<string, unknown>> = [];

function installDom(html: string): Document {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return dom.window.document;
}

function mockChrome(): void {
  listeners = [];
  sentMessages = [];
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          listeners.push(fn);
        },
      },
      sendMessage: vi.fn(async (m: Record<string, unknown>) => {
        sentMessages.push(m);
      }),
    },
    storage: {
      local: { get: async () => ({}) },
      session: { get: async () => ({}) },
    },
  };
}

function emit(msg: unknown): void {
  listeners.forEach((fn) => fn(msg));
}

/** Flush the async fill/ack promise chains (fake timers, no real awaits). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  mockChrome();
  installDom('');
  // jsdom lacks crypto.subtle — provide node's webcrypto so computeJobUid runs.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

const JD = {
  title: '高级后端',
  company: '某某科技',
  salaryText: '20-40K',
  requirements: '熟悉 Java/Go，五年以上后端经验。',
  hrName: '王女士',
};

describe('dispatch on an open liepin chat input', () => {
  it('fills the chat box and acks ok — never sends', async () => {
    const doc = installDom('<textarea class="chat-input"></textarea>');
    installLiepinAgentClient();

    emit({ type: 'tomihunt-dispatch', requestId: 'r1', targetId: 'jd:x', text: '您好，我是……' });
    await flush();

    const input = doc.querySelector<HTMLTextAreaElement>('textarea.chat-input')!;
    expect(input.value).toContain('您好');
    const ack = sentMessages.find((m) => m.type === 'tomi-ack');
    expect(ack).toMatchObject({ requestId: 'r1', ok: true });
  });

  it('ignores non-dispatch messages', async () => {
    installDom('<textarea class="chat-input"></textarea>');
    installLiepinAgentClient();

    emit({ type: 'tomi-session-sync' });
    await flush();

    expect(sentMessages).toEqual([]);
  });

  it('acks the LIVE counterpart from the open overlay — not a recruiter name elsewhere on the page', async () => {
    // 柯女士 is a detail-page recruiter card; the open chat overlay is .im-chat
    // and its header says 王先生 — the overlay is the person the chat actually
    // talks to, so the ack must carry 王先生.
    installDom(`
      <div class="recruiter-name">柯女士</div>
      <div class="im-chat">
        <div class="im-chat-header"><h3 class="im-name">王先生</h3><span>能良电商</span></div>
        <div class="im-message-item">你好，我是该岗位招聘负责人</div>
        <textarea class="im-chat-input"></textarea>
      </div>`);
    installLiepinAgentClient();

    emit({ type: 'tomihunt-dispatch', requestId: 'r-live', targetId: 'jd:x', text: '您好，我是…' });
    await flush();

    const ack = sentMessages.find((m) => m.type === 'tomi-ack');
    expect(ack).toMatchObject({ requestId: 'r-live', ok: true, recruiter: '王先生' });
  });
});

describe('readChatCounterpart', () => {
  it('returns the name token inside the chat overlay only', async () => {
    const doc = installDom(`
      <div class="recruiter-name">柯女士</div>
      <div class="im-chat">
        <div class="im-chat-header"><span class="im-name">王先生</span></div>
        <textarea class="im-chat-input"></textarea>
      </div>`);
    expect(readChatCounterpart(doc)).toBe('王先生');
  });

  it('returns undefined when no chat input (overlay closed) is present', async () => {
    const doc = installDom('<div class="recruiter-name">柯女士</div>');
    expect(readChatCounterpart(doc)).toBeUndefined();
  });

  it('skips hidden names', async () => {
    const doc = installDom(`
      <div class="im-chat">
        <div class="im-chat-header" style="display:none"><span>柯女士</span></div>
        <textarea class="im-chat-input"></textarea>
      </div>`);
    expect(readChatCounterpart(doc)).toBeUndefined();
  });
});

describe('dispatch when the liepin chat is not open yet', () => {
  it('clicks 聊一聊 to open the overlay, then fills and acks ok', async () => {
    const doc = installDom('<button>聊一聊</button>');
    installLiepinAgentClient();
    // Opening the chat overlay is async on the real site — simulate it.
    doc.querySelector('button')!.addEventListener('click', () => {
      const input = doc.createElement('textarea');
      input.className = 'chat-input';
      doc.body.appendChild(input);
    });

    emit({ type: 'tomihunt-dispatch', requestId: 'r2', targetId: 'jd:x', text: '您好，看到贵司的岗位…' });
    await vi.advanceTimersByTimeAsync(900); // first open-retry tick
    await flush();

    const input = doc.querySelector<HTMLTextAreaElement>('textarea.chat-input');
    expect(input).toBeTruthy();
    expect(input!.value).toContain('您好');
    const ack = sentMessages.find((m) => m.type === 'tomi-ack');
    expect(ack).toMatchObject({ requestId: 'r2', ok: true });
  });

  it('acks an error when neither an input nor a 聊一聊 button exists', async () => {
    installDom('<div>just a job page</div>');
    installLiepinAgentClient();

    emit({ type: 'tomihunt-dispatch', requestId: 'r3', targetId: 'jd:x', text: 'hi' });
    await flush();

    const ack = sentMessages.find((m) => m.type === 'tomi-ack');
    expect(ack).toMatchObject({ requestId: 'r3', ok: false });
    expect(String(ack?.error)).toContain('未找到聊天输入框');
  });
});

describe('registerChatSession (page tab = drivable session)', () => {
  it('upserts jd:<uid>, re-upserts on SW sync, removes on pagehide', async () => {
    installDom('');
    await registerChatSession(JD);

    expect(sentMessages[0]).toMatchObject({
      type: 'tomi-session',
      action: 'upsert',
      targetId: 'jd:2ade5e80c09dfce3', // sha256('某某科技'|'高级后端') — matches core vectors
    });

    emit({ type: 'tomi-session-sync' });
    await flush();
    const upserts = sentMessages.filter((m) => m.type === 'tomi-session' && m.action === 'upsert');
    expect(upserts).toHaveLength(2);

    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(sentMessages).toContainEqual({ type: 'tomi-session', action: 'remove', targetId: 'jd:2ade5e80c09dfce3' });
  });

  it('trims company/title like core when deriving the session id', async () => {
    installDom('');
    await registerChatSession({ ...JD, company: '  某某科技  ', title: ' 高级后端 ' });
    expect(sentMessages[0]).toMatchObject({ targetId: 'jd:2ade5e80c09dfce3' });
  });
});
