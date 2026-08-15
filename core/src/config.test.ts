import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeHomeWithConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
  mkdirSync(join(dir, '.tomi-job-hunt'), { recursive: true });
  writeFileSync(join(dir, '.tomi-job-hunt', 'config.json'), JSON.stringify(config));
  return dir;
}

describe('loadConfig', () => {
  it('returns defaults when nothing is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    const cfg = loadConfig({ home: dir, env: {} });
    expect(cfg.llm.provider).toBe('claude-code');
    expect(cfg.llm.model).toBe('claude-sonnet-5');
    expect(cfg.llm.concurrency).toBe(2);
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
  });

  it('reads config.json from home dir', () => {
    const home = makeHomeWithConfig({
      provider: 'claude-api',
      model: 'claude-haiku-4-5-20251001',
      concurrency: 4,
      port: 4000,
    });
    const cfg = loadConfig({ home, env: {} });
    expect(cfg.llm.provider).toBe('claude-api');
    expect(cfg.llm.model).toBe('claude-haiku-4-5-20251001');
    expect(cfg.llm.concurrency).toBe(4);
    expect(cfg.port).toBe(4000);
    rmSync(home, { recursive: true, force: true });
  });

  it('env vars override config.json', () => {
    const home = makeHomeWithConfig({ provider: 'claude-api', port: 4000 });
    const cfg = loadConfig({
      home,
      env: { TOMI_PROVIDER: 'openai-compatible', TOMI_PORT: '5000', ANTHROPIC_API_KEY: 'sk-test' },
    });
    expect(cfg.llm.provider).toBe('openai-compatible');
    expect(cfg.llm.model).toBeUndefined(); // openai-compatible has no default
    expect(cfg.port).toBe(5000);
    expect(cfg.llm.apiKey).toBe('sk-test');
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves presets for deepseek/kimi/qwen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    const deepseek = loadConfig({ home: dir, env: { TOMI_PROVIDER: 'deepseek', TOMI_API_KEY: 'sk-ds' } });
    expect(deepseek.llm.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(deepseek.llm.model).toBe('deepseek-v4-flash');
    expect(deepseek.llm.apiKey).toBe('sk-ds');

    const kimi = loadConfig({ home: dir, env: { TOMI_PROVIDER: 'kimi' } });
    expect(kimi.llm.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(kimi.llm.model).toBe('kimi-k2.6');

    const qwen = loadConfig({ home: dir, env: { TOMI_PROVIDER: 'qwen' } });
    expect(qwen.llm.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(qwen.llm.model).toBe('qwen3.7-plus');
  });

  it('TOMI_BASE_URL and TOMI_MODEL override presets; thinking from config.json', () => {
    const home = makeHomeWithConfig({ provider: 'deepseek', thinking: true });
    const cfg = loadConfig({
      home,
      env: { TOMI_BASE_URL: 'http://127.0.0.1:9999/v1', TOMI_MODEL: 'deepseek-v4-pro' },
    });
    expect(cfg.llm.baseUrl).toBe('http://127.0.0.1:9999/v1');
    expect(cfg.llm.model).toBe('deepseek-v4-pro');
    expect(cfg.llm.thinking).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  it('throws on unknown provider', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    expect(() => loadConfig({ home: dir, env: { TOMI_PROVIDER: 'nope' } })).toThrow(/Unknown TOMI_PROVIDER/);
  });

  it('throws on invalid config.json', () => {
    const home = makeHomeWithConfig({ concurrency: 99 });
    expect(() => loadConfig({ home, env: {} })).toThrow(/Invalid/);
    rmSync(home, { recursive: true, force: true });
  });
});
