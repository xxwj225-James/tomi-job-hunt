import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreClient, _resetCoreBaseCache, getCoreBase } from './core-client.js';

function mockChrome(stored: unknown = undefined): void {
  const store = new Map<string, unknown>();
  if (stored !== undefined) store.set('tomihunt-core-base', stored);
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          const data: Record<string, unknown> = {};
          for (const k of Array.isArray(key) ? key : [key]) {
            if (store.has(k)) data[k] = store.get(k);
          }
          return data;
        },
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
      },
    },
  };
}

function healthJson(provider: string): object {
  return { ok: true, provider, queue: { active: 0, pending: 0 } };
}

beforeEach(() => {
  _resetCoreBaseCache(); // module-level memory cache leaks across tests otherwise
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('getCoreBase (port auto-discovery)', () => {
  it('finds Core on a shifted port when the base port serves something else', async () => {
    mockChrome();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('34567')) {
        // foreign app on the base port — 404 HTML
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }
      if (url.includes('34568')) {
        return { ok: true, status: 200, json: async () => healthJson('deepseek') } as Response;
      }
      throw new Error('no server');
    });
    vi.stubGlobal('fetch', fetchMock);

    const base = await getCoreBase();
    expect(base).toBe('http://127.0.0.1:34568');
  });

  it('returns null when nothing is listening', async () => {
    mockChrome();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connection refused');
    }));
    expect(await getCoreBase()).toBeNull();
  });

  it('serves the persisted cache without probing', async () => {
    const at = Date.now();
    mockChrome({ base: 'http://127.0.0.1:34570', at });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const base = await getCoreBase();
    expect(base).toBe('http://127.0.0.1:34570');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('CoreClient.captureJd', () => {
  const jd = {
    source: 'zhipin' as const,
    url: 'https://www.zhipin.com/job_detail/a.html',
    title: '后端工程师',
    company: '甲厂',
    salaryText: '20-30K',
    requirements: '写 Java',
  };

  function stubCapture(): { bodies: unknown[] } {
    const bodies: unknown[] = [];
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 202, json: async () => ({ jobUid: 'uid-1', taggingJobId: 'job-1' }) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return { bodies };
  }

  it('sends tag:false in the body only when explicitly requested', async () => {
    mockChrome({ base: 'http://127.0.0.1:34570', at: Date.now() });
    const { bodies } = stubCapture();
    const client = new CoreClient();

    await client.captureJd(jd, { tag: false }); // silent 库 import (SPA browse)
    expect(bodies[0]).toEqual({ ...jd, tag: false });

    await client.captureJd(jd); // default → normal tag flow, no transport flag
    expect(bodies[1]).not.toHaveProperty('tag');
    expect(bodies[1]).toEqual(jd);
  });

  it('ignores tag:true opts (only tag === false switches to silent import)', async () => {
    mockChrome({ base: 'http://127.0.0.1:34570', at: Date.now() });
    const { bodies } = stubCapture();
    const client = new CoreClient();
    await client.captureJd(jd, { tag: true });
    expect(bodies[0]).toEqual(jd); // no tag key leaked to the wire
  });

  it('returns jobUid + taggingJobId from the 202 response', async () => {
    mockChrome({ base: 'http://127.0.0.1:34570', at: Date.now() });
    stubCapture();
    const client = new CoreClient();
    const res = await client.captureJd(jd);
    expect(res).toEqual({ jobUid: 'uid-1', taggingJobId: 'job-1' });
  });
});
