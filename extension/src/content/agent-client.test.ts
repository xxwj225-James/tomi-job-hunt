// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { webcrypto } from 'node:crypto';
import { computeJobUid, installAgentClient } from './agent-client.js';

/** The listener captured by installAgentClient's chrome.runtime.onMessage. */
type Listener = (msg: unknown) => void;
let dispatchListener: Listener | null = null;
let sentMessages: Array<Record<string, unknown>> = [];

function installDom(html: string): Document {
  const dom = new JSDOM(html);
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return dom.window.document;
}

function mockChrome(): void {
  dispatchListener = null;
  sentMessages = [];
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          dispatchListener = fn;
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

function dispatch(msg: Record<string, unknown>): void {
  dispatchListener?.(msg);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockChrome();
  // jsdom lacks crypto.subtle — provide node's webcrypto so computeJobUid runs.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('computeJobUid', () => {
  it('matches core vectors (sha256(company|title) first 16 hex)', async () => {
    expect(await computeJobUid('某某科技', '高级后端')).toBe('2ade5e80c09dfce3');
    expect(await computeJobUid('某公司', '前端工程师')).toBe('44b96aaa591895fc');
    expect(await computeJobUid('深圳某科技', '高级前端（React）')).toBe('49c04cf91862da7b');
  });

  it('trims inputs like core does', async () => {
    expect(await computeJobUid('  某某科技 ', ' 高级后端 ')).toBe(await computeJobUid('某某科技', '高级后端'));
  });

  it('differs across companies/titles and is 16 chars', async () => {
    const a = await computeJobUid('A公司', '后端');
    const b = await computeJobUid('A公司', '前端');
    const c = await computeJobUid('B公司', '后端');
    expect(a).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('installAgentClient', () => {
  it('fills the chat box, highlights it, and acks ok — never sends', () => {
    const doc = installDom(
      `<html><body><div class="chat-input" contenteditable="true"></div><button class="btn-send" style="display:none">发送</button></body></html>`,
    );
    installAgentClient();
    const input = doc.querySelector('.chat-input')!;
    const keys: string[] = [];
    input.addEventListener('keydown', (e) => keys.push((e as KeyboardEvent).key));

    dispatch({ type: 'tomihunt-dispatch', requestId: 'r1', targetId: 'jd:abc', text: '你好，我是……' });

    expect(input.textContent).toContain('你好');
    expect(keys).not.toContain('Enter'); // compliance: the extension never sends
    expect(sentMessages.at(0)).toMatchObject({
      type: 'tomi-ack',
      requestId: 'r1',
      ok: true,
      domSnippet: '已填入聊天框并高亮，请确认后在页面发送',
    });
  });

  it('acks ok:false with an error when no chat input exists', () => {
    installDom(`<html><body><p>no chat here</p></body></html>`);
    installAgentClient();

    dispatch({ type: 'tomihunt-dispatch', requestId: 'r2', targetId: 'jd:abc', text: 'hi' });

    expect(sentMessages.at(0)).toMatchObject({
      type: 'tomi-ack',
      requestId: 'r2',
      ok: false,
    });
    expect((sentMessages.at(0) as { error?: string }).error).toBe('未找到聊天输入框');
  });

  it('ignores unrelated runtime messages', () => {
    installDom(`<html><body><div></div></body></html>`);
    installAgentClient();
    dispatch({ type: 'something-else', payload: 1 });
    expect(sentMessages).toHaveLength(0);
  });
});
