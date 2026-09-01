import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFeedback,
  aggregatePersonalRules,
  loadFeedback,
  MAX_FEEDBACK,
  personalRulesPrompt,
  submitFeedback,
} from './feedback.js';

const store: Record<string, unknown> = {};

function mockChromeStorage(): void {
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (obj: Record<string, unknown>) => Object.assign(store, obj),
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  mockChromeStorage();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('feedback storage', () => {
  it('loadFeedback is empty initially', async () => {
    expect(await loadFeedback()).toEqual([]);
  });

  it('addFeedback appends and is capped at MAX_FEEDBACK (drops oldest)', async () => {
    for (let i = 0; i < MAX_FEEDBACK + 5; i += 1) {
      await addFeedback({ feature: 'greeting', thumbs: 'down', tags: ['too-long'], note: `n${i}` });
    }
    const all = await loadFeedback();
    expect(all).toHaveLength(MAX_FEEDBACK);
    expect(all[0]!.note).toBe('n5'); // oldest dropped, keeps the newest 200
    expect(all[all.length - 1]!.note).toBe(`n${MAX_FEEDBACK + 4}`);
  });
});

describe('aggregatePersonalRules', () => {
  it('maps down-thumb tags to rule sentences and counts repeats', () => {
    const rules = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'down', tags: ['too-long'] },
      { feature: 'greeting', ts: 2, thumbs: 'down', tags: ['too-long', 'too-stiff'] },
    ]);
    expect(rules).toContain('打招呼语不要太长');
    expect(rules).toContain('（2 次）');
    expect(rules).toContain('口语化');
  });

  it('includes recent notes and ignores empty ones', () => {
    const rules = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'down', tags: ['too-long'], note: '  ' },
      { feature: 'greeting', ts: 2, thumbs: 'down', tags: [], note: '结尾请加一句提问' },
    ]);
    expect(rules).toContain('用户补充：结尾请加一句提问');
  });

  it('adds a positive line after enough up-thumbs', () => {
    const rules = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'up', tags: [] },
      { feature: 'greeting', ts: 2, thumbs: 'up', tags: [] },
      { feature: 'greeting', ts: 3, thumbs: 'up', tags: [] },
    ]);
    expect(rules).toContain('认可了 3 条');
  });

  it('returns empty string for an empty store', () => {
    expect(aggregatePersonalRules([])).toBe('');
  });
});

describe('personalRulesPrompt', () => {
  it('wraps rules with a marker', () => {
    expect(personalRulesPrompt('打招呼语不要太长')).toBe('[长期偏好规则] 用户希望：\n打招呼语不要太长');
  });
  it('returns empty for empty input', () => {
    expect(personalRulesPrompt('   ')).toBe('');
  });
});

describe('submitFeedback (anonymous opt-in upload)', () => {
  const ENDPOINT = 'https://feedback.example.test/fb';
  const ENTRY = { feature: 'greeting', ts: 1, thumbs: 'down' as const, tags: ['too-long'], note: 'x' };

  beforeEach(() => {
    store['tomihunt-feedback-optin'] = true;
  });

  it('posts the entry when opt-in and endpoint are set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await submitFeedback(ENTRY, ENDPOINT)).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({ feature: 'greeting', thumbs: 'down', tags: ['too-long'], note: 'x' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uploads by default when the opt-in key is absent (default ON)', async () => {
    delete store['tomihunt-feedback-optin'];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await submitFeedback(ENTRY, ENDPOINT)).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips silently when opt-in is off', async () => {
    store['tomihunt-feedback-optin'] = false;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await submitFeedback(ENTRY, ENDPOINT)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips silently when the endpoint is empty (not deployed)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await submitFeedback(ENTRY, '')).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns false on network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      expect(await submitFeedback(ENTRY, ENDPOINT)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
