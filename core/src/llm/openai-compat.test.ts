import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { OpenAICompatProvider, SseDecoder } from './openai-compat.js';
import { Logger } from '../logger.js';
import type { LLMConfig } from '../types.js';

const silentLog = new Logger('error', 'test');

// --- SseDecoder unit tests ---

describe('SseDecoder', () => {
  it('parses delta.content across chunk boundaries', () => {
    const sse = new SseDecoder();
    expect(sse.feed('data: {"choices":[{"delta":{"content":"你"}}]}\n\nda')).toEqual(['你']);
    expect(sse.feed('ta: {"choices":[{"delta":{"content":"好"}}]}\n\n')).toEqual(['好']);
  });

  it('skips [DONE], non-data lines and malformed JSON', () => {
    const sse = new SseDecoder();
    const out = sse.feed(
      ': keep-alive\n' +
        'data: {"choices":[{"delta":{"content":"a"}}]}\n' +
        'data: [DONE]\n' +
        'data: not-json\n' +
        'garbage line\n',
    );
    expect(out).toEqual(['a']);
  });

  it('ignores deltas without content', () => {
    const sse = new SseDecoder();
    expect(sse.feed('data: {"choices":[{"delta":{"reasoning_content":"thinking..."}}]}\n')).toEqual([]);
  });
});

// --- Integration tests against a mock OpenAI-compatible server ---

function makeCfg(overrides: Partial<LLMConfig>): LLMConfig {
  return {
    provider: 'deepseek',
    apiKey: 'sk-test',
    baseUrl: '',
    model: 'test-model',
    concurrency: 2,
    ...overrides,
  };
}

let server: Server;
let baseUrl = '';
let lastBody: Record<string, unknown> = {};
let lastAuth = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c.toString('utf8');
    });
    req.on('end', () => {
      lastBody = JSON.parse(raw) as Record<string, unknown>;
      lastAuth = req.headers.authorization ?? '';
      const stream = lastBody.stream === true;
      res.setHeader('Content-Type', stream ? 'text/event-stream' : 'application/json');
      if (stream) {
        res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
        res.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
        res.end('data: [DONE]\n\n');
      } else {
        res.end(
          JSON.stringify({
            model: lastBody.model,
            choices: [{ message: { content: '你好', reasoning_content: '思考中' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('OpenAICompatProvider', () => {
  it('chat() sends Bearer auth and parses response', async () => {
    const provider = new OpenAICompatProvider(makeCfg({ baseUrl }), silentLog);
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'test-model',
    });
    expect(result.text).toBe('你好');
    expect(result.model).toBe('test-model');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
    expect(lastAuth).toBe('Bearer sk-test');
    expect(lastBody.model).toBe('test-model');
  });

  it('chatStream() yields incremental chunks', async () => {
    const provider = new OpenAICompatProvider(makeCfg({ baseUrl }), silentLog);
    const chunks: string[] = [];
    for await (const chunk of provider.chatStream({ messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk.text);
    }
    expect(chunks).toEqual(['你', '好', '']);
    expect(lastBody.stream).toBe(true);
  });

  it('deepseek sends thinking disabled by default', async () => {
    // Provider-specific params are keyed off baseUrl (TomiLite pattern) —
    // mock URLs carry the provider keyword as a path suffix.
    const provider = new OpenAICompatProvider(
      makeCfg({ baseUrl: `${baseUrl}/deepseek`, model: 'deepseek-v4-flash' }),
      silentLog,
    );
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(lastBody.thinking).toEqual({ type: 'disabled' });
  });

  it('deepseek sends thinking enabled when configured', async () => {
    const provider = new OpenAICompatProvider(
      makeCfg({ baseUrl: `${baseUrl}/deepseek`, model: 'deepseek-v4-pro', thinking: true }),
      silentLog,
    );
    await provider.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(lastBody.thinking).toEqual({ type: 'enabled' });
  });

  it('qwen sends enable_thinking only when true', async () => {
    const qwen = new OpenAICompatProvider(
      makeCfg({ provider: 'qwen', baseUrl: `${baseUrl}/dashscope`, model: 'qwen3.7-plus' }),
      silentLog,
    );
    await qwen.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(lastBody.enable_thinking).toBeUndefined();

    const qwenThinking = new OpenAICompatProvider(
      makeCfg({ provider: 'qwen', baseUrl: `${baseUrl}/dashscope`, model: 'qwen3.8-max', thinking: true }),
      silentLog,
    );
    await qwenThinking.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(lastBody.enable_thinking).toBe(true);
  });

  it('kimi sends standard params only', async () => {
    const kimi = new OpenAICompatProvider(
      makeCfg({ provider: 'kimi', baseUrl, model: 'kimi-k2.6' }),
      silentLog,
    );
    await kimi.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(lastBody.thinking).toBeUndefined();
    expect(lastBody.enable_thinking).toBeUndefined();
  });

  it('rejects on missing apiKey', () => {
    expect(() => new OpenAICompatProvider(makeCfg({ apiKey: undefined }), silentLog)).toThrow(/Missing API key/);
  });

  it('rejects on missing baseUrl', () => {
    expect(() => new OpenAICompatProvider(makeCfg({ baseUrl: undefined }), silentLog)).toThrow(/Missing baseUrl/);
  });
});
