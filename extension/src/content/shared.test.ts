// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { _resetCoreBaseCache } from '../core-client.js';
import type { JdCaptureInput, JdTags } from '../types.js';
import { captureAndShow, enterJobView, fillChatBox, pickLongText, pickText, stripHidden } from './shared.js';

function installDom(html: string): { doc: Document; win: Window & typeof globalThis } {
  const dom = new JSDOM(html, { url: 'https://www.zhipin.com/job_detail/test.html' });
  // Content-script helpers read the global document/window.
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return { doc: dom.window.document, win: dom.window };
}

describe('stripHidden + text extraction', () => {
  it('strips inline-hidden interference words from JD text', () => {
    const { doc } = installDom(`
      <html><body>
        <div class="job-sec-text">
          要求熟悉 Java<span style="display:none">外包驻场加班严重</span>，双休
          <span style="visibility:hidden">996</span>
        </div>
      </body></html>`);
    const text = pickText(doc, ['.job-sec-text']);
    expect(text).toBe('要求熟悉 Java，双休');
    expect(text).not.toContain('外包');
    expect(text).not.toContain('996');
  });

  it('strips elements hidden by stylesheet rules', () => {
    const { doc } = installDom(`
      <html><head><style>.ad-word { display: none; }</style></head><body>
        <div class="job-description">真实 JD 内容<span class="ad-word">虚假高薪内推</span>结束</div>
      </body></html>`);
    const text = pickLongText(doc, ['.job-description']);
    expect(text).toBe('真实 JD 内容结束');
  });

  it('does not mutate the live DOM', () => {
    const { doc } = installDom(`
      <html><body><div class="x">正常<span style="display:none">隐藏</span></div></body></html>`);
    pickText(doc, ['.x']);
    expect(doc.querySelector('.x')?.textContent).toBe('正常隐藏');
  });
});

describe('fillChatBox', () => {
  it('fills a contenteditable div and dispatches input events', () => {
    const { doc } = installDom(`
      <html><body><div id="chat-input" class="chat-input" contenteditable="true"></div></body></html>`);
    let inputFired = false;
    doc.querySelector('.chat-input')!.addEventListener('input', () => {
      inputFired = true;
    });
    const filled = fillChatBox('你好，看到贵司岗位', ['#chat-input.chat-input[contenteditable="true"]', '.chat-input']);
    expect(filled).toBe(true);
    expect(doc.querySelector('.chat-input')?.textContent).toBe('你好，看到贵司岗位');
    expect(inputFired).toBe(true);
  });

  it('fills a React-controlled textarea via the native value setter', () => {
    const { doc } = installDom(`<html><body><textarea class="input-area"></textarea></body></html>`);
    const ta = doc.querySelector('textarea')!;
    let inputFired = false;
    ta.addEventListener('input', () => {
      inputFired = true;
    });
    const filled = fillChatBox('文本', ['textarea']);
    expect(filled).toBe(true);
    expect(ta.value).toBe('文本');
    expect(inputFired).toBe(true);
  });

  it('returns false when no candidate element exists', () => {
    const { doc } = installDom(`<html><body></body></html>`);
    expect(fillChatBox('文本', ['.chat-input'])).toBe(false);
  });
});

describe('captureAndShow view-epoch guard (SPA job switches)', () => {
  // Stable shared document for the whole describe: the panel host is created
  // once by ensurePanel() and must stay attached to the SAME doc across tests
  // (the earlier installDom() tests each swap in their own detached doc).
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://www.zhipin.com/web/geek/jobs' });
  const doc = dom.window.document;
  const panelText = (): string =>
    (doc.getElementById('tomihunt-panel-host')?.shadowRoot?.querySelector('#tomi-panel')?.textContent ?? '');

  interface FakeSocket {
    url: string;
    closeCalls: number;
    onmessage: ((msg: { data: string }) => void) | null;
  }
  let sockets: FakeSocket[] = [];

  const jdA: JdCaptureInput = {
    source: 'zhipin',
    url: 'https://www.zhipin.com/job_detail/a.html',
    title: '后端工程师A',
    company: '甲厂',
    salaryText: '20-30K',
    requirements: '写 Java',
  };
  const jdB: JdCaptureInput = {
    source: 'zhipin',
    url: 'https://www.zhipin.com/job_detail/b.html',
    title: '算法工程师B',
    company: '乙厂',
    salaryText: '30-50K',
    requirements: '写 Python',
  };
  const tagsOf = (risk: string): JdTags => ({
    techStack: ['Java'],
    yearsReq: '3-5',
    degreeReq: '本科',
    workHours: '弹性',
    salaryBandK: [20, 30],
    riskFlags: [risk],
    summary: `summary-${risk}`,
  });

  function mockChrome(coreBase: string): void {
    const local = new Map<string, unknown>([['tomihunt-core-base', { base: coreBase, at: Date.now() }]]);
    const session = new Map<string, unknown>();
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: async (key: string | string[]) => {
            const out: Record<string, unknown> = {};
            for (const k of Array.isArray(key) ? key : [key]) if (local.has(k)) out[k] = local.get(k);
            return out;
          },
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) local.set(k, v);
          },
        },
        session: {
          get: async (key: string) => ({ [key]: session.get(key) }),
          set: async (obj: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(obj)) session.set(k, v);
          },
        },
      },
    };
  }

  function stubCore(uidFor: (title: string) => string): void {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as unknown as Response;
      if (url.endsWith('/health')) {
        return json({ ok: true, provider: 'deepseek', queue: { active: 0, pending: 0 } });
      }
      if (url.endsWith('/v1/jd/capture')) {
        const body = JSON.parse(String(init?.body)) as { title: string };
        const suffix = uidFor(body.title);
        return json({ jobUid: `uid-${suffix}`, taggingJobId: `job-${suffix}` });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 200; i += 1) await Promise.resolve();
  }

  beforeAll(() => {
    (globalThis as { document?: unknown }).document = dom.window.document;
    (globalThis as { window?: unknown }).window = dom.window;
  });

  beforeEach(() => {
    _resetCoreBaseCache();
    sockets = [];
    delete (globalThis as Record<string, unknown>).chrome;
    vi.stubGlobal(
      'WebSocket',
      class FakeWebSocket {
        onmessage: ((msg: { data: string }) => void) | null = null;
        closeCalls = 0;
        constructor(public url: string) {
          sockets.push(this);
        }
        close(): void {
          this.closeCalls += 1;
        }
      } as unknown as typeof WebSocket,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('a superseded job’s late tagged result never paints over the current view; its socket closes once', async () => {
    mockChrome('http://127.0.0.1:34570');
    stubCore((title) => (title.includes('A') ? 'A' : 'B'));
    const pA = captureAndShow({ jd: jdA }, 'TomiHunt · 甲厂 A');
    await settle();
    expect(sockets).toHaveLength(1);
    const wsA = sockets[0]!;
    expect(wsA.closeCalls).toBe(0);

    // The SPA controller adopts a NEW job → the shared view epoch bumps and the
    // still-running capture of the OLD job is disposed (interval + socket).
    enterJobView();
    expect(wsA.closeCalls).toBe(1);

    // Core finishes the OLD job AFTER the switch: it must NOT paint over the
    // current view, and settle must not double-close the socket.
    wsA.onmessage?.({ data: JSON.stringify({ type: 'jd/tagged', jobId: 'job-A', jobUid: 'uid-A', tags: tagsOf('A仅本岗') }) });
    await settle();
    expect(panelText()).toContain('AI 结构化分析中'); // still the current tagging view
    expect(panelText()).not.toContain('A仅本岗');
    expect(wsA.closeCalls).toBe(1);

    // A capture for the CURRENT job completes normally → paints its tags.
    const pB = captureAndShow({ jd: jdB }, 'TomiHunt · 乙厂 B');
    await settle();
    const wsB = sockets[1]!;
    wsB.onmessage?.({ data: JSON.stringify({ type: 'jd/tagged', jobId: 'job-B', jobUid: 'uid-B', tags: tagsOf('B仅本岗') }) });
    await settle();
    expect(panelText()).toContain('B仅本岗');
    expect(panelText()).not.toContain('A仅本岗');
    expect(wsB.closeCalls).toBe(1); // settle closes the socket exactly once
    await Promise.all([pA, pB]);
  });

  it('a normal (still-current) capture paints its tags and closes the watch socket exactly once on settle', async () => {
    mockChrome('http://127.0.0.1:34570');
    stubCore((title) => (title.includes('C') ? 'C' : 'other'));
    const jdC: JdCaptureInput = {
      source: 'zhipin',
      url: 'https://www.zhipin.com/job_detail/c.html',
      title: '前端工程师C',
      company: '丙厂',
      salaryText: '15-25K',
      requirements: '写 TS',
    };
    const p = captureAndShow({ jd: jdC }, 'TomiHunt · 丙厂 C');
    await settle();
    expect(sockets).toHaveLength(1);
    const ws = sockets[0]!;
    expect(ws.closeCalls).toBe(0);

    ws.onmessage?.({ data: JSON.stringify({ type: 'jd/tagged', jobId: 'job-C', jobUid: 'uid-C', tags: tagsOf('C仅本岗') }) });
    await settle();
    expect(panelText()).toContain('C仅本岗');
    expect(ws.closeCalls).toBe(1);
    await p;
  });
});
