import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoreBase } from './core-client.js';

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
