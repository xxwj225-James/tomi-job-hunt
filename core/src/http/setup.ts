/**
 * First-run setup wizard (Phase A launcher UX).
 *
 *   GET  /setup          HTML wizard page (zero-dependency, inline CSS/JS)
 *   GET  /setup/config   current stored config (API key masked)
 *   POST /setup/config   save config (merge, hot-reloads the provider)
 *   POST /setup/test     test an LLM connection with submitted config
 *   POST /setup/resume   upload a resume file (pdf/docx/txt/md) → config dir
 *
 * All endpoints are local-only (the server binds 127.0.0.1) — the wizard is
 * the GUI replacement for hand-editing ~/.tomi-job-hunt/config.json.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ChatProvider, LLMConfig, ProviderId } from '../types.js';
import type { Logger } from '../logger.js';
import { PROVIDER_IDS, PROVIDER_PRESETS, readConfigFile, saveConfigFile } from '../config.js';
import { loadResumeFile } from '../jd/resume-files.js';

export interface SetupDeps {
  configDir: string;
  log: Logger;
  /** Recreate the active provider after a config save (hot reload). */
  reloadProvider: (cfg: LLMConfig) => void;
  /** Provider factory — injectable for tests. */
  createProvider: (cfg: LLMConfig, log: Logger, workDir: string) => ChatProvider;
  /** Dedicated work dir for claude-code subprocess isolation. */
  workDir: string;
}

const testSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  thinking: z.boolean().optional(),
});

const configPatchSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS).optional(),
    model: z.string().optional(),
    /** Empty string leaves the stored key untouched. */
    apiKey: z.string().optional(),
    /** Erase the stored key entirely. */
    clearApiKey: z.boolean().optional(),
    baseUrl: z.string().optional(),
    thinking: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
    concurrency: z.number().int().min(1).max(16).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  })
  .passthrough();

function maskKey(key: string | undefined): { apiKeySet: boolean; apiKeyMasked?: string } {
  if (!key) return { apiKeySet: false };
  const masked = key.length > 8 ? `${key.slice(0, 3)}****${key.slice(-4)}` : '****';
  return { apiKeySet: true, apiKeyMasked: masked };
}

export function registerSetupRoutes(app: Hono, deps: SetupDeps): void {
  const { configDir, log } = deps;

  // --- Config state (masked) ---

  app.get('/setup/config', (c) => {
    const raw = readConfigFile(configDir);
    const provider = (raw.provider as ProviderId | undefined) ?? 'claude-code';
    const model = (raw.model as string | undefined) ?? '';
    const { apiKeySet, apiKeyMasked } = maskKey(raw.apiKey as string | undefined);
    const baseUrl = (raw.baseUrl as string | undefined) ?? '';
    return c.json({
      configDir,
      configFileExists: existsSync(join(configDir, 'config.json')),
      provider,
      model,
      apiKeySet,
      apiKeyMasked,
      baseUrl,
      thinking: raw.thinking === true,
      temperature: (raw.temperature as number | undefined) ?? 0.3,
      concurrency: (raw.concurrency as number | undefined) ?? 2,
      port: (raw.port as number | undefined) ?? 3000,
      logLevel: (raw.logLevel as string | undefined) ?? 'info',
    });
  });

  // --- Save config (merge + hot reload) ---

  app.post('/setup/config', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = configPatchSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ ok: false, error: `Invalid config: ${detail}` }, 400);
    }
    const patch = parsed.data as Parameters<typeof saveConfigFile>[1];
    try {
      const saved = saveConfigFile(configDir, patch);
      // Hot-reload the running provider so the change applies without a restart.
      const provider = (saved.provider as ProviderId) ?? 'claude-code';
      const llm: LLMConfig = {
        provider,
        model: (saved.model as string | undefined) || PROVIDER_PRESETS[provider]?.defaultModel,
        apiKey: saved.apiKey as string | undefined,
        baseUrl: (saved.baseUrl as string | undefined) ?? PROVIDER_PRESETS[provider]?.baseUrl,
        thinking: saved.thinking === true,
        temperature: saved.temperature as number | undefined,
        concurrency: (saved.concurrency as number) ?? 2,
      };
      deps.reloadProvider(llm);
      const { apiKeySet } = maskKey(saved.apiKey as string | undefined);
      log.info(`setup: config saved (provider: ${provider}, apiKeySet: ${apiKeySet})`);
      return c.json({ ok: true, apiKeySet });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  // --- Connection test (submitted config, not saved) ---

  app.post('/setup/test', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ ok: false, error: `Invalid request: ${detail}` }, 400);
    }
    const { provider, model, apiKey, baseUrl, thinking } = parsed.data;
    if (!apiKey && provider !== 'claude-code') {
      return c.json({ ok: false, error: '请填写 API Key 再测试连接' }, 400);
    }
    const cfg: LLMConfig = {
      provider,
      // Fall back to the preset default model so "test" works even when the
      // model field was left blank (e.g. deepseek-v4-flash by default).
      model: model || PROVIDER_PRESETS[provider]?.defaultModel,
      apiKey,
      baseUrl: baseUrl || PROVIDER_PRESETS[provider]?.baseUrl,
      thinking: thinking === true,
      concurrency: 1,
    };
    const probe = deps.createProvider(cfg, log.child('setup-test'), deps.workDir);
    try {
      const result = await probe.chat({ messages: [{ role: 'user', content: '回复：OK' }] });
      return c.json({
        ok: true,
        message: `连接成功（模型: ${result.model}）`,
        model: result.model,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`setup: connection test failed: ${message}`);
      return c.json({ ok: false, error: `连接失败: ${message}` }, 502);
    }
  });

  // --- Resume upload (stored as resume.<ext> in the config dir) ---

  const RESUME_EXTS = ['pdf', 'docx', 'txt', 'md'] as const;

  // The user's own resume, served back for the extension's recovery flow.
  // Localhost-only endpoint; the resume never leaves the machine.
  app.get('/setup/resume', async (c) => {
    const resume = await loadResumeFile(configDir, log);
    return c.json({ exists: Boolean(resume), resume: resume ?? '' });
  });

  app.post('/setup/resume', async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File) || !file.name) {
      return c.json({ ok: false, error: '请选择要上传的简历文件（PDF / Word / txt / md）' }, 400);
    }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase() as (typeof RESUME_EXTS)[number];
    if (!(RESUME_EXTS as readonly string[]).includes(ext)) {
      return c.json(
        { ok: false, error: '不支持的简历格式。支持: PDF / .docx / .txt / .md（旧版 .doc 请另存为 .docx）' },
        400,
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Validate by parsing a throwaway copy first — reject files that yield no
    // text (e.g. scanned PDFs) before they overwrite the current resume.
    const dir = mkdtempSync(join(tmpdir(), 'tomi-resume-upload-'));
    writeFileSync(join(dir, `resume.${ext}`), bytes);
    const parsed = await loadResumeFile(dir);
    rmSync(dir, { recursive: true, force: true });
    if (!parsed) {
      return c.json(
        { ok: false, error: '无法从该文件提取文本（扫描件 PDF 请直接粘贴文本到 resume.md）' },
        400,
      );
    }

    const target = join(configDir, `resume.${ext}`);
    writeFileSync(target, bytes);
    log.info(`setup: resume saved (${file.name} → resume.${ext}, ${bytes.length} bytes)`);
    return c.json({ ok: true, message: `简历已保存（${file.name}），已立即生效`, path: target });
  });

  // --- Wizard page ---

  app.get('/setup', (c) =>
    c.html(setupPageHtml(PROVIDER_PRESETS)),
  );
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code（本机 CLI，Agent 能力最强）',
  'claude-api': 'Claude API（Anthropic 直连）',
  deepseek: 'DeepSeek（国内直连、成本最低）',
  kimi: 'Kimi（Moonshot）',
  qwen: 'Qwen（阿里云百炼）',
  'openai-compatible': 'OpenAI 兼容端点（自建/OneAPI/Ollama）',
};

function setupPageHtml(presets: Record<string, { baseUrl: string; defaultModel?: string }>): string {
  const presetJson = JSON.stringify(
    Object.fromEntries(
      PROVIDER_IDS.map((id) => [
        id,
        { ...presets[id], defaultModel: presets[id]?.defaultModel ?? '' },
      ]),
    ),
  ).replace(/</g, '\\u003c');
  const options = PROVIDER_IDS.map(
    (id) => `<option value="${id}">${PROVIDER_LABELS[id] ?? id}</option>`,
  ).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TomiHunt 本地服务设置</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; line-height: 1.6; }
  h1 { font-size: 1.5em; }
  .card { border: 1px solid #8884; border-radius: 12px; padding: 20px; margin: 16px 0; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input[type=text], input[type=password], select { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid #8886; font-size: 14px; }
  .hint { font-size: 12px; color: #888; margin: 4px 0 0; font-weight: 400; }
  .row { display: flex; gap: 10px; margin-top: 16px; }
  button { padding: 9px 18px; border-radius: 8px; border: 1px solid #8886; background: #2563eb; color: #fff; font-size: 14px; cursor: pointer; }
  button.secondary { background: transparent; color: #2563eb; }
  #status { margin-top: 12px; font-size: 14px; white-space: pre-wrap; }
  .ok { color: #16a34a; } .err { color: #dc2626; }
  .muted { color: #888; font-size: 13px; }
</style>
</head>
<body>
<h1>🤖 TomiHunt 本地服务设置</h1>
<p class="muted">配置保存在本机 <code>~/.tomi-job-hunt/config.json</code>，API Key 不会离开你的电脑。</p>

<div class="card">
  <label for="provider">LLM 服务商</label>
  <select id="provider">${options}</select>
  <p class="hint" id="provider-hint"></p>

  <label for="model">模型（可留空用默认）</label>
  <input type="text" id="model" placeholder="deepseek-v4-flash">
  <p class="hint" id="model-hint"></p>

  <label for="apiKey">API Key</label>
  <input type="password" id="apiKey" placeholder="sk-..." autocomplete="off">
  <p class="hint" id="key-hint">只保存在本机。留空表示不修改已保存的 Key。</p>

  <label for="baseUrl">API 地址（可选，默认按服务商预设）</label>
  <input type="text" id="baseUrl" placeholder="留空使用默认地址">

  <div class="row">
    <button id="test" class="secondary">测试连接</button>
    <button id="save">保存设置</button>
  </div>
  <div id="status"></div>
</div>

<div class="card">
  <h2 style="margin-top:0">简历（可选但强烈建议）</h2>
  <p class="muted">上传 PDF / Word / txt / md，本机解析、立即生效。打招呼语/打分/面试准备会结合真实经历，质量显著提升。</p>
  <input type="file" id="resume-file" accept=".pdf,.docx,.txt,.md">
  <div class="row">
    <button id="upload" class="secondary">上传简历</button>
  </div>
  <div id="resume-status"></div>
</div>

<p class="muted" style="margin-top:24px">保存后即可打开 Boss直聘/猎聘岗位页使用。所有数据仅存本机：<code id="config-dir"></code></p>

<script>
const PRESETS = ${presetJson};
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const resumeStatusEl = $('resume-status');

function show(el, ok, msg) {
  el.textContent = msg;
  el.className = ok ? 'ok' : 'err';
}

function presetHint() {
  const p = PRESETS[$('provider').value];
  $('model-hint').textContent = p && p.defaultModel ? \`默认模型: \${p.defaultModel}\` : '需手动指定模型';
  $('provider-hint').textContent = p ? \`默认地址: \${p.baseUrl}\` : '';
  if (!p || !p.defaultModel) $('model').placeholder = '';
  else if (!$('model').value) $('model').placeholder = p.defaultModel;
}

$('provider').addEventListener('change', presetHint);

function collectCfg() {
  return {
    provider: $('provider').value,
    model: $('model').value.trim() || undefined,
    apiKey: $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim() || undefined,
  };
}

$('test').addEventListener('click', async () => {
  const body = collectCfg();
  if (!body.apiKey && body.provider !== 'claude-code') {
    show(statusEl, false, '请先填写 API Key');
    return;
  }
  show(statusEl, true, '正在测试连接…');
  try {
    const r = await fetch('/setup/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    show(statusEl, j.ok, j.ok ? \`✅ \${j.message}\` : \`❌ \${j.error}\`);
  } catch (e) {
    show(statusEl, false, \`❌ 请求失败: \${e.message}\`);
  }
});

$('save').addEventListener('click', async () => {
  const body = collectCfg();
  show(statusEl, true, '正在保存…');
  try {
    const r = await fetch('/setup/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.ok) {
      $('apiKey').value = '';
      show(statusEl, true, '✅ 设置已保存并立即生效。现在可以打开 Boss直聘/猎聘岗位页使用了。');
    } else {
      show(statusEl, false, \`❌ \${j.error}\`);
    }
  } catch (e) {
    show(statusEl, false, \`❌ 请求失败: \${e.message}\`);
  }
});

$('upload').addEventListener('click', async () => {
  const file = $('resume-file').files[0];
  if (!file) { show(resumeStatusEl, false, '请先选择简历文件'); return; }
  show(resumeStatusEl, true, \`正在解析 \${file.name}…\`);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/setup/resume', { method: 'POST', body: fd });
    const j = await r.json();
    show(resumeStatusEl, j.ok, j.ok ? \`✅ \${j.message}\` : \`❌ \${j.error}\`);
  } catch (e) {
    show(resumeStatusEl, false, \`❌ 请求失败: \${e.message}\`);
  }
});

(async () => {
  try {
    const r = await fetch('/setup/config');
    const j = await r.json();
    $('provider').value = j.provider;
    $('model').value = j.model || '';
    $('baseUrl').value = j.baseUrl || '';
    $('config-dir').textContent = j.configDir;
    presetHint();
    if (j.apiKeySet) $('key-hint').textContent = \`已保存 Key（\${j.apiKeyMasked}）。留空表示不修改。\`;
  } catch { /* server just started — keep defaults */ }
  presetHint();
})();
</script>
</body>
</html>`;
}
