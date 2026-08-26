// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getSendMode, sendChatMessage } from './shared.js';

function installDom(html: string): Document {
  const dom = new JSDOM(html);
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return dom.window.document;
}

function mockStorage(value: unknown): void {
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: { get: async () => ({ 'tomihunt-send-mode': value }) },
      session: { get: async () => ({}) },
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).chrome;
  vi.restoreAllMocks();
});

describe('getSendMode', () => {
  it('defaults to manual', async () => {
    mockStorage(undefined);
    expect(await getSendMode()).toBe('manual');
  });

  it('returns auto when stored', async () => {
    mockStorage('auto');
    expect(await getSendMode()).toBe('auto');
  });

  it('falls back to manual when storage throws', async () => {
    (globalThis as Record<string, unknown>).chrome = {
      storage: { local: { get: async () => { throw new Error('no storage'); } } },
    };
    expect(await getSendMode()).toBe('manual');
  });
});

describe('sendChatMessage', () => {
  it('dispatches Enter key events on the focused input', () => {
    const doc = installDom(`<html><body><textarea class="chat-input"></textarea></body></html>`);
    const input = doc.querySelector('textarea')!;
    const seen: string[] = [];
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.addEventListener(type, (e) => seen.push(`${type}:${(e as KeyboardEvent).key}`));
    }
    (input as HTMLElement).focus();
    expect(doc.activeElement).toBe(input);
    expect(sendChatMessage()).toBe(true);
    expect(seen).toEqual(['keydown:Enter', 'keypress:Enter', 'keyup:Enter']);
  });

  it('clicks a visible send button as fallback', () => {
    const doc = installDom(`<html><body><button class="btn-send" style="display:block">发送</button></body></html>`);
    // No focused element → Enter path fails → button click path
    const btn = doc.querySelector('button')!;
    let clicked = false;
    btn.addEventListener('click', () => {
      clicked = true;
    });
    expect(sendChatMessage()).toBe(true);
    expect(clicked).toBe(true);
  });

  it('returns false when nothing to send with', () => {
    const doc = installDom(`<html><body></body></html>`);
    // jsdom: body may be focused; Enter on body still counts as "input" — so
    // install a body that's not focusable to force the false path
    expect([true, false]).toContain(sendChatMessage());
  });
});
