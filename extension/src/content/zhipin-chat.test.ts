// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatJobIdentity } from './zhipin-chat.js';

const PITCH_KEY = 'tomihunt-pitch';
const LAST_JD_KEY = 'tomihunt-last-jd';
const NOW = 1_700_000_000_000;

/** Fake chrome.storage.session backed by a plain map, seeded per test. */
function mockChromeSession(seed: Record<string, unknown>): void {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: { onMessage: { addListener: () => undefined }, sendMessage: async () => undefined },
    storage: {
      session: {
        get: async (key: string) => (key in seed ? { [key]: seed[key] } : {}),
      },
    },
  };
}

function lastJd(company: string, title: string, at: number): Record<string, unknown> {
  return { jd: { company, title, url: 'https://example.test/job' }, at };
}

function pitch(company: string, jdTitle: string): Record<string, unknown> {
  return { pitch: '您好，我是……', jdTitle, company, ts: NOW };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('chatJobIdentity', () => {
  it('prefers the stored pitch — it was generated for a known job', async () => {
    mockChromeSession({
      [PITCH_KEY]: pitch('上海近硕半导体技术', '研发总监'),
      // A different job on the page must NOT win over the pitch.
      [LAST_JD_KEY]: lastJd('别家公司', '别的岗位', NOW),
    });

    expect(await chatJobIdentity('上海近硕半导体技术 研发总监', NOW)).toEqual({
      company: '上海近硕半导体技术',
      title: '研发总监',
    });
  });

  it('registers without a pitch when the page matches the last-shown JD', async () => {
    // The app-driven flow: the desktop app writes the greeting itself, so no
    // extension-side pitch exists. This is the case that used to register
    // nothing and made every 填入 fail as "插件未上线".
    mockChromeSession({ [LAST_JD_KEY]: lastJd('上海近硕半导体技术', '研发总监', NOW - 30_000) });

    expect(await chatJobIdentity('上海近硕半导体技术 · 研发总监\n您好，很高兴和您沟通', NOW)).toEqual({
      company: '上海近硕半导体技术',
      title: '研发总监',
    });
  });

  it('refuses a last JD older than the freshness window', async () => {
    mockChromeSession({ [LAST_JD_KEY]: lastJd('上海近硕半导体技术', '研发总监', NOW - 11 * 60_000) });

    expect(await chatJobIdentity('上海近硕半导体技术 · 研发总监', NOW)).toBeNull();
  });

  it('accepts a last JD at the freshness boundary', async () => {
    mockChromeSession({ [LAST_JD_KEY]: lastJd('上海近硕半导体技术', '研发总监', NOW - 10 * 60_000) });

    expect(await chatJobIdentity('上海近硕半导体技术', NOW)).not.toBeNull();
  });

  it('refuses when the page is about somebody else', async () => {
    // Fresh, but the open conversation is with a different company: filling
    // here would drop the greeting into the wrong chat.
    mockChromeSession({ [LAST_JD_KEY]: lastJd('上海近硕半导体技术', '研发总监', NOW - 30_000) });

    expect(await chatJobIdentity('某某网络科技 · 前端工程师', NOW)).toBeNull();
  });

  it('refuses a stored pitch the page contradicts', async () => {
    // Boss swaps conversations inside the chat SPA without a reload, so a pitch
    // left over from the previous conversation can outlive its job. Trusting it
    // would strand this tab's registration on the wrong JD.
    mockChromeSession({ [PITCH_KEY]: pitch('上海近硕半导体技术', '研发总监') });

    expect(await chatJobIdentity('某某网络科技 · 前端工程师', NOW)).toBeNull();
  });

  it('falls back to the title when BOSS masked the company', async () => {
    mockChromeSession({ [LAST_JD_KEY]: lastJd('某大型上市公司', '高级算法工程师', NOW - 30_000) });

    // A masked name never appears in page text, so matching on it would refuse
    // every such job. The title decides instead — here it IS on the page.
    expect(await chatJobIdentity('高级算法工程师', NOW)).toEqual({
      company: '某大型上市公司',
      title: '高级算法工程师',
    });
  });

  it('still refuses a masked company whose title is not on the page', async () => {
    mockChromeSession({ [LAST_JD_KEY]: lastJd('某大型上市公司', '高级算法工程师', NOW - 30_000) });

    expect(await chatJobIdentity('某大型上市公司 · 前端工程师', NOW)).toBeNull();
  });

  it('treats a pre-timestamp record as permanently stale', async () => {
    // Legacy shape written by a build before saveLastJd stored `at`: usable as
    // smart-reply context, never as identity.
    mockChromeSession({ [LAST_JD_KEY]: { company: '上海近硕半导体技术', title: '研发总监' } });

    expect(await chatJobIdentity('上海近硕半导体技术', NOW)).toBeNull();
  });

  it('returns null with nothing stored at all', async () => {
    mockChromeSession({});

    expect(await chatJobIdentity('随便什么页面', NOW)).toBeNull();
  });
});
