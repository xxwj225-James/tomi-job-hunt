import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJson, scrubUnsupportedYears } from './prompts.js';
import { directChat, loadDirectConfig, DirectLlmError } from './llm.js';

// --- extractJson (same algorithm as core) ---

describe('extractJson', () => {
  it('extracts JSON from prose and code fences', () => {
    expect(extractJson('好的：```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJson('{"a": {"b": [1]}}')).toBe('{"a": {"b": [1]}}');
  });

  it('throws when no JSON present', () => {
    expect(() => extractJson('no json here')).toThrow();
  });
});

// --- scrubUnsupportedYears (deterministic anti-fabrication net) ---

describe('scrubUnsupportedYears', () => {
  it('removes a year claim not present in the resume, keeping the skill', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。', '简历：Java开发，3年经验')).toBe(
      '您好，我有Java开发经验。',
    );
  });

  it('keeps a year claim that IS present in the resume', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。', '简历：Java 5年')).toBe(
      '您好，我有5年Java开发经验。',
    );
  });

  it('strips "X年以上" claims too, not just plain "X年"', () => {
    expect(scrubUnsupportedYears('您好，我有5年以上后端经验。', '简历：后端经验')).toBe(
      '您好，我有后端经验。',
    );
  });

  it('does not touch a year that is part of a larger number (15年 vs 5年)', () => {
    expect(scrubUnsupportedYears('您好，我有15年后端经验。', '简历：15年后端')).toBe(
      '您好，我有15年后端经验。',
    );
  });

  it('is a no-op without a resume (prompt already forbids claims)', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。')).toBe('您好，我有5年Java开发经验。');
  });
});

// --- directChat with mocked storage + fetch ---

function mockStorage(cfg: unknown): void {
  (globalThis as Record<string, unknown>).chrome = {
    storage: { local: { get: async () => ({ 'tomihunt-llm-config': cfg }) } },
  };
}

function mockFetch(response: unknown, ok = true): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 401,
    json: async () => response,
    text: async () => JSON.stringify(response),
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).chrome;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe('directChat', () => {
  it('throws a helpful error when no API key configured', async () => {
    mockStorage(undefined);
    await expect(directChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/设置/);
  });

  it('calls the deepseek preset with Bearer auth and thinking disabled', async () => {
    mockStorage({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-test' });
    const fetchMock = mockFetch({
      model: 'deepseek-v4-flash',
      choices: [{ message: { content: '你好' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const result = await directChat([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('你好');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('surfaces API errors with status', async () => {
    mockStorage({ provider: 'kimi', model: 'kimi-k2.6', apiKey: 'sk-test' });
    mockFetch({ error: { message: 'invalid key' } }, false);
    await expect(directChat([{ role: 'user', content: 'hi' }])).rejects.toThrow('API 错误 401');
  });

  it('generic provider uses the user-provided base URL and model', async () => {
    mockStorage({
      provider: 'generic',
      model: 'my-model',
      apiKey: 'sk-gw',
      baseUrl: 'http://127.0.0.1:9999/v1/',
    });
    const fetchMock = mockFetch({
      model: 'my-model',
      choices: [{ message: { content: 'gateway ok' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    });
    const result = await directChat([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('gateway ok');
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9999/v1/chat/completions'); // trailing slash trimmed
  });

  it('generic provider rejects missing base URL', async () => {
    mockStorage({ provider: 'generic', model: 'm', apiKey: 'sk-gw' });
    mockFetch({});
    await expect(directChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Base URL/);
  });
});

describe('loadDirectConfig', () => {
  it('returns null without an apiKey', async () => {
    mockStorage({ provider: 'deepseek', model: 'x', apiKey: '' });
    expect(await loadDirectConfig()).toBeNull();
  });

  it('returns the config when apiKey is present', async () => {
    mockStorage({ provider: 'deepseek', model: 'x', apiKey: 'sk-1' });
    expect((await loadDirectConfig())?.provider).toBe('deepseek');
  });
});

// keep the import used (DirectLlmError referenced in types only)
void DirectLlmError;
