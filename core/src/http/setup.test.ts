import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { registerSetupRoutes } from './setup.js';
import { Logger } from '../logger.js';
import { readSecret, writeSecret } from '../security.js';
import type { ChatProvider, ChatRequest, ChatResult, LLMConfig } from '../types.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures', import.meta.url));
const silentLog = new Logger('error', 'test');

interface SetupHarness {
  app: Hono;
  configDir: string;
  reloaded: LLMConfig[];
}

async function makeHarness(initialConfig?: Record<string, unknown>): Promise<SetupHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'tomi-setup-'));
  mkdirSync(dir, { recursive: true });
  if (initialConfig) {
    const { apiKey, ...rest } = initialConfig;
    if (Object.keys(rest).length > 0) {
      writeFileSync(join(dir, 'config.json'), JSON.stringify(rest, null, 2));
    }
    // Keys live in the DPAPI-encrypted secret store — never config.json.
    if (typeof apiKey === 'string' && apiKey) {
      await writeSecret(dir, apiKey, silentLog);
    }
  }
  const reloaded: LLMConfig[] = [];
  const fakeProvider: ChatProvider = {
    id: 'deepseek',
    async chat(req: ChatRequest): Promise<ChatResult> {
      return { text: 'OK', model: req.model ?? 'fake-model', usage: { inputTokens: 1, outputTokens: 1 } };
    },
    async *chatStream() {
      yield { text: 'OK', done: true };
    },
  };
  const app = new Hono();
  registerSetupRoutes(app, {
    configDir: dir,
    log: silentLog,
    workDir: join(dir, 'work'),
    reloadProvider: (cfg) => reloaded.push(cfg),
    createProvider: async () => fakeProvider,
  });
  return { app, configDir: dir, reloaded };
}

describe('GET /setup', () => {
  it('serves the wizard HTML page', async () => {
    const { app, configDir } = await makeHarness();
    const res = await app.request('/setup');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('TomiHunt 本地服务设置');
    expect(html).toContain('test');
    expect(html).toContain('resume-file');
    // LLM narrowing: wizard surfaces DeepSeek only (no claude/kimi/qwen options).
    expect(html).toContain('deepseek');
    expect(html).toContain('如何获取 DeepSeek API Key');
    expect(html).not.toContain('claude-code');
    expect(html).not.toContain('kimi');
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('GET /setup/config', () => {
  it('returns defaults when no config file exists', async () => {
    const { app, configDir } = await makeHarness();
    const res = await app.request('/setup/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.provider).toBe('deepseek');
    expect(body.apiKeySet).toBe(false);
    expect(body.configFileExists).toBe(false);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('masks the stored API key', async () => {
    const { app, configDir } = await makeHarness({ provider: 'deepseek', apiKey: 'sk-abcdefghijkl1234', model: 'deepseek-v4-flash' });
    const res = await app.request('/setup/config');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.apiKeySet).toBe(true);
    expect(body.apiKeyMasked).toBe('sk-****');
    expect(JSON.stringify(body)).not.toContain('sk-abcdefghijkl1234');
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('POST /setup/config', () => {
  it('saves a new config and hot-reloads the provider', async () => {
    const { app, configDir, reloaded } = await makeHarness();
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-new-key' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; apiKeySet: boolean };
    expect(body.ok).toBe(true);
    expect(body.apiKeySet).toBe(true);
    // config.json written
    const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(stored.provider).toBe('deepseek');
    expect(stored.apiKey).toBeUndefined(); // never in config.json
    expect(await readSecret(configDir)).toBe('sk-new-key'); // encrypted store
    // provider hot-reloaded with the new config
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.provider).toBe('deepseek');
    expect(reloaded[0]!.apiKey).toBe('sk-new-key');
    rmSync(configDir, { recursive: true, force: true });
  });

  it('keeps the stored key when apiKey is empty', async () => {
    const { app, configDir } = await makeHarness({ provider: 'kimi', apiKey: 'sk-old', model: 'kimi-k2.6' });
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'kimi', model: 'kimi-k2.6', apiKey: '' }),
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(stored.apiKey).toBeUndefined(); // never in config.json
    expect(await readSecret(configDir)).toBe('sk-old'); // secret survives
    rmSync(configDir, { recursive: true, force: true });
  });

  it('clears the key when clearApiKey is set', async () => {
    const { app, configDir } = await makeHarness({ provider: 'kimi', apiKey: 'sk-old' });
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearApiKey: true }),
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(stored.apiKey).toBeUndefined();
    rmSync(configDir, { recursive: true, force: true });
  });

  it('preserves unknown fields (e.g. intel) on merge', async () => {
    const { app, configDir } = await makeHarness({
      provider: 'deepseek',
      apiKey: 'sk-x',
      intel: { nostr: { relays: ['wss://relay.damus.io'] } },
    });
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'qwen', model: 'qwen3.7-plus' }),
    });
    expect(res.status).toBe(200);
    const stored = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')) as Record<string, unknown>;
    expect(stored.provider).toBe('qwen');
    expect((stored.intel as { nostr: { relays: string[] } }).nostr.relays).toEqual(['wss://relay.damus.io']);
    expect(stored.apiKey).toBeUndefined();
    expect(await readSecret(configDir)).toBe('sk-x');
    rmSync(configDir, { recursive: true, force: true });
  });

  it('rejects invalid config', async () => {
    const { app, configDir } = await makeHarness();
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 999 }),
    });
    expect(res.status).toBe(400);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('falls back to the preset default model when model is blank', async () => {
    const { app, configDir, reloaded } = await makeHarness();
    const res = await app.request('/setup/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', apiKey: 'sk-x', model: '' }),
    });
    expect(res.status).toBe(200);
    expect(reloaded[0]!.model).toBe('deepseek-v4-flash');
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('POST /setup/test', () => {
  it('returns ok with the fake provider', async () => {
    const { app, configDir } = await makeHarness();
    const res = await app.request('/setup/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', apiKey: 'sk-test' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toContain('连接成功');
    rmSync(configDir, { recursive: true, force: true });
  });

  it('requires an api key for non-claude-code providers', async () => {
    const { app, configDir } = await makeHarness();
    const res = await app.request('/setup/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek' }),
    });
    expect(res.status).toBe(400);
    rmSync(configDir, { recursive: true, force: true });
  });
});

describe('POST /setup/resume', () => {
  async function uploadResume(app: Hono, filename: string, bytes: Uint8Array): Promise<Response> {
    const form = new FormData();
    form.append('file', new File([bytes], filename));
    return app.request('/setup/resume', { method: 'POST', body: form });
  }

  it('accepts a pdf and stores it as resume.pdf', async () => {
    const { app, configDir } = await makeHarness();
    const pdf = readFileSync(join(FIXTURES, 'resume-minimal.pdf'));
    const res = await uploadResume(app, 'my-resume.pdf', new Uint8Array(pdf));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(readFileSync(join(configDir, 'resume.pdf')).length).toBe(pdf.length);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('accepts a docx and stores it as resume.docx', async () => {
    const { app, configDir } = await makeHarness();
    const docx = readFileSync(join(FIXTURES, 'resume-minimal.docx'));
    const res = await uploadResume(app, '简历.docx', new Uint8Array(docx));
    expect(res.status).toBe(200);
    expect(readFileSync(join(configDir, 'resume.docx')).length).toBe(docx.length);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('rejects unsupported extensions', async () => {
    const { app, configDir } = await makeHarness();
    const res = await uploadResume(app, 'resume.rtf', new TextEncoder().encode('x'));
    expect(res.status).toBe(400);
    rmSync(configDir, { recursive: true, force: true });
  });

  it('rejects files with no extractable text (scanned pdf)', async () => {
    const { app, configDir } = await makeHarness();
    const res = await uploadResume(app, 'scanned.pdf', new TextEncoder().encode('not a real pdf'));
    expect(res.status).toBe(400);
    rmSync(configDir, { recursive: true, force: true });
  });
});
