import { describe, expect, it } from 'vitest';
import { loadConfig, readConfigFile, saveConfigFile } from './config.js';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeHomeWithConfig(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
  mkdirSync(join(dir, '.tomi-job-hunt'), { recursive: true });
  writeFileSync(join(dir, '.tomi-job-hunt', 'config.json'), JSON.stringify(config));
  return dir;
}

describe('loadConfig', () => {
  it('returns defaults when nothing is configured', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    const cfg = await loadConfig({ home: dir, env: {} });
    expect(cfg.llm.provider).toBe('deepseek');
    expect(cfg.llm.model).toBe('deepseek-v4-flash');
    expect(cfg.llm.concurrency).toBe(2);
    expect(cfg.port).toBe(34567);
    expect(cfg.logLevel).toBe('info');
  });

  it('reads config.json from home dir', async () => {
    const home = makeHomeWithConfig({
      provider: 'claude-api',
      model: 'claude-haiku-4-5-20251001',
      concurrency: 4,
      port: 4000,
    });
    const cfg = await loadConfig({ home, env: {} });
    expect(cfg.llm.provider).toBe('claude-api');
    expect(cfg.llm.model).toBe('claude-haiku-4-5-20251001');
    expect(cfg.llm.concurrency).toBe(4);
    expect(cfg.port).toBe(4000);
    rmSync(home, { recursive: true, force: true });
  });

  it('env vars override config.json', async () => {
    const home = makeHomeWithConfig({ provider: 'claude-api', port: 4000 });
    const cfg = await loadConfig({
      home,
      env: { TOMI_PROVIDER: 'openai-compatible', TOMI_PORT: '5000', ANTHROPIC_API_KEY: 'sk-test' },
    });
    expect(cfg.llm.provider).toBe('openai-compatible');
    expect(cfg.llm.model).toBeUndefined(); // openai-compatible has no default
    expect(cfg.port).toBe(5000);
    expect(cfg.llm.apiKey).toBe('sk-test');
    rmSync(home, { recursive: true, force: true });
  });

  it('resolves presets for deepseek/kimi/qwen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    const deepseek = await loadConfig({ home: dir, env: { TOMI_PROVIDER: 'deepseek', TOMI_API_KEY: 'sk-ds' } });
    expect(deepseek.llm.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(deepseek.llm.model).toBe('deepseek-v4-flash');
    expect(deepseek.llm.apiKey).toBe('sk-ds');

    const kimi = await loadConfig({ home: dir, env: { TOMI_PROVIDER: 'kimi' } });
    expect(kimi.llm.baseUrl).toBe('https://api.moonshot.cn/v1');
    expect(kimi.llm.model).toBe('kimi-k2.6');

    const qwen = await loadConfig({ home: dir, env: { TOMI_PROVIDER: 'qwen' } });
    expect(qwen.llm.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(qwen.llm.model).toBe('qwen3.7-plus');
  });

  it('TOMI_BASE_URL and TOMI_MODEL override presets; thinking from config.json', async () => {
    const home = makeHomeWithConfig({ provider: 'deepseek', thinking: true });
    const cfg = await loadConfig({
      home,
      env: { TOMI_BASE_URL: 'http://127.0.0.1:9999/v1', TOMI_MODEL: 'deepseek-v4-pro' },
    });
    expect(cfg.llm.baseUrl).toBe('http://127.0.0.1:9999/v1');
    expect(cfg.llm.model).toBe('deepseek-v4-pro');
    expect(cfg.llm.thinking).toBe(true);
    rmSync(home, { recursive: true, force: true });
  });

  it('throws on unknown provider', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-config-'));
    await expect(loadConfig({ home: dir, env: { TOMI_PROVIDER: 'nope' } })).rejects.toThrow(/Unknown TOMI_PROVIDER/);
  });

  it('throws on invalid config.json', async () => {
    const home = makeHomeWithConfig({ concurrency: 99 });
    await expect(loadConfig({ home, env: {} })).rejects.toThrow(/Invalid/);
    rmSync(home, { recursive: true, force: true });
  });
});

describe('saveConfigFile', () => {
  it('writes config.json WITHOUT the key; the key goes to the encrypted store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-save-'));
    const cfgDir = join(dir, '.tomi-job-hunt');
    try {
      await saveConfigFile(cfgDir, { provider: 'deepseek', apiKey: 'sk-new', model: 'deepseek-v4-flash' });
      const raw = JSON.parse(readFileSync(join(cfgDir, 'config.json'), 'utf8')) as Record<string, unknown>;
      expect(raw.provider).toBe('deepseek');
      expect(raw.apiKey).toBeUndefined(); // never in config.json
      const cfg = await loadConfig({ home: dir, env: {} });
      expect(cfg.llm.apiKey).toBe('sk-new'); // decryptable from the secret file
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges into an existing config and preserves unknown fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-save-'));
    const cfgDir = join(dir, '.tomi-job-hunt');
    try {
      mkdirSync(cfgDir, { recursive: true });
      writeFileSync(
        join(cfgDir, 'config.json'),
        JSON.stringify({ provider: 'kimi', apiKey: 'sk-old', intel: { nostr: { relays: ['wss://x'] } } }),
      );
      await saveConfigFile(cfgDir, { provider: 'qwen', model: 'qwen3.7-plus' });
      const raw = JSON.parse(readFileSync(join(cfgDir, 'config.json'), 'utf8')) as Record<string, unknown>;
      expect(raw.provider).toBe('qwen');
      expect(raw.apiKey).toBeUndefined(); // never in config.json
      expect((await loadConfig({ home: dir, env: {} })).llm.apiKey).toBe('sk-old'); // migrated to secret
      expect((raw.intel as { nostr: { relays: string[] } }).nostr.relays).toEqual(['wss://x']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('empty apiKey keeps the stored secret; clearApiKey erases it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-save-'));
    const cfgDir = join(dir, '.tomi-job-hunt');
    try {
      await saveConfigFile(cfgDir, { provider: 'kimi', apiKey: 'sk-old' });
      await saveConfigFile(cfgDir, { apiKey: '   ' });
      expect((await loadConfig({ home: dir, env: {} })).llm.apiKey).toBe('sk-old');
      await saveConfigFile(cfgDir, { clearApiKey: true });
      expect((await loadConfig({ home: dir, env: {} })).llm.apiKey).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('migrates a legacy apiKey out of config.json into the encrypted store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-save-'));
    try {
      mkdirSync(join(dir, '.tomi-job-hunt'), { recursive: true });
      writeFileSync(join(dir, '.tomi-job-hunt', 'config.json'), JSON.stringify({ provider: 'kimi', apiKey: 'sk-legacy' }));
      const cfg = await loadConfig({ home: dir, env: {} });
      expect(cfg.llm.apiKey).toBe('sk-legacy');
      const raw = JSON.parse(readFileSync(join(dir, '.tomi-job-hunt', 'config.json'), 'utf8')) as Record<string, unknown>;
      expect(raw.apiKey).toBeUndefined(); // stripped
      expect(existsSync(join(dir, '.tomi-job-hunt', 'api-key.enc'))).toBe(true); // encrypted copy
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects invalid values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-save-'));
    try {
      await expect(saveConfigFile(dir, { concurrency: 999 })).rejects.toThrow(/Invalid/);
      await expect(saveConfigFile(dir, { provider: 'nope' as never })).rejects.toThrow(/Invalid/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
