/**
 * Options page — direct-mode LLM config (provider / model / API key).
 * Stored in chrome.storage.local; readable by content scripts.
 */
import { loadDirectConfig, presetFor, testDirectConnection, type DirectLlmConfig } from '../direct/llm.js';
import { syncConfigToCore } from '../core-client.js';
import { parseResumeFile, ResumeParseError } from './resume-parser.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`options: missing #${id}`);
  return el as T;
};

const providerEl = $<HTMLSelectElement>('provider');
const baseUrlEl = $<HTMLInputElement>('baseUrl');
const modelEl = $<HTMLInputElement>('model');
const apiKeyEl = $<HTMLInputElement>('apiKey');
const statusEl = $<HTMLDivElement>('status');
const modelHintEl = $<HTMLDivElement>('model-hint');
const baseUrlHintEl = $<HTMLDivElement>('baseUrl-hint');
const resumeEl = $<HTMLTextAreaElement>('resume');
const resumeFileEl = $<HTMLInputElement>('resume-file');
const sendModeEl = $<HTMLSelectElement>('sendMode');
const smartReplyEl = $<HTMLSelectElement>('smartReply');

function showStatus(ok: boolean, message: string): void {
  statusEl.textContent = message;
  statusEl.className = ok ? 'ok' : 'err';
}

function updateModelHint(): void {
  const preset = presetFor(providerEl.value as DirectLlmConfig['provider']);
  if (preset) {
    modelHintEl.textContent = `默认: ${preset.defaultModel}（可留空）`;
    if (!modelEl.value) modelEl.placeholder = preset.defaultModel;
    if (!baseUrlEl.value) baseUrlEl.placeholder = preset.baseUrl;
    baseUrlHintEl.textContent = '已自动填充预设地址，可修改（如代理网关）';
  } else {
    modelHintEl.textContent = '请填写模型名称（必填）';
    if (!modelEl.value) modelEl.placeholder = '如 deepseek-v4-flash / gpt-4o-mini';
    baseUrlHintEl.textContent = '必填：任意 OpenAI 兼容地址（自建网关 / OneAPI / Ollama 等）';
    if (!baseUrlEl.value) baseUrlEl.placeholder = 'https://你的网关地址/v1';
  }
}

providerEl.addEventListener('change', updateModelHint);

async function buildConfig(): Promise<DirectLlmConfig> {
  const provider = providerEl.value as DirectLlmConfig['provider'];
  const preset = presetFor(provider);
  const cfg: DirectLlmConfig = {
    provider,
    model: modelEl.value.trim() || preset?.defaultModel || '',
    apiKey: apiKeyEl.value.trim(),
    baseUrl: baseUrlEl.value.trim() || undefined,
    // thinking mode stays internal (off = cheaper, stable JSON) — not user-facing
  };
  return cfg;
}

// Resume file upload — parsed locally in the browser, never uploaded
resumeFileEl.addEventListener('change', async () => {
  const file = resumeFileEl.files?.[0];
  if (!file) return;
  showStatus(true, `正在解析 ${file.name}…`);
  try {
    const text = await parseResumeFile(file);
    resumeEl.value = text;
    await chrome.storage.local.set({ 'tomihunt-resume': text });
    showStatus(true, `✅ 已解析并保存（${file.name}，${text.length} 字）。可在下方编辑后重新保存。`);
  } catch (err) {
    showStatus(false, `❌ ${err instanceof ResumeParseError ? err.message : `解析失败: ${(err as Error).message}`}`);
  }
});

$('save').addEventListener('click', async () => {
  const cfg = await buildConfig();
  if (!cfg.apiKey) {
    showStatus(false, '请先填写 API Key');
    return;
  }
  await chrome.storage.local.set({
    'tomihunt-llm-config': cfg,
    'tomihunt-send-mode': sendModeEl.value === 'auto' ? 'auto' : 'manual',
    'tomihunt-smart-reply': smartReplyEl.value === 'off' ? 'off' : 'on',
  });
  if (resumeEl.value.trim()) {
    await chrome.storage.local.set({ 'tomihunt-resume': resumeEl.value.trim() });
  }
  // Keep the running Core in agreement (silent no-op when Core is offline)
  const synced = await syncConfigToCore(cfg);
  // Saving always verifies the connection so the user knows immediately
  showStatus(true, '✅ 已保存，正在测试连接…');
  const result = await testDirectConnection(cfg);
  showStatus(
    result.ok,
    result.ok
      ? `✅ 已保存${synced ? '并同步到本地 Core' : ''}；连接测试通过（${result.message}）`
      : `⚠️ 已保存，但连接测试失败：${result.message}（请检查 API Key 或 Base URL）`,
  );
});

$('test').addEventListener('click', async () => {
  const cfg = await buildConfig();
  if (!cfg.apiKey) {
    showStatus(false, '请先填写 API Key');
    return;
  }
  showStatus(true, '正在测试连接…');
  const result = await testDirectConnection(cfg);
  showStatus(result.ok, result.ok ? `✅ ${result.message}` : `❌ ${result.message}`);
});


// --- Config backup: export/import (survives folder changes & reinstalls) ---

$('export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get([
    'tomihunt-llm-config',
    'tomihunt-resume',
    'tomihunt-send-mode',
    'tomihunt-smart-reply',
  ]);
  const blob = new Blob([JSON.stringify({ tomihuntBackup: 1, savedAt: new Date().toISOString(), ...data }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tomihunt-backup.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus(true, '✅ 备份文件已下载，请妥善保存（含 API Key）。');
});

$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text()) as Record<string, unknown>;
    if (parsed.tomihuntBackup !== 1) throw new Error('不是 TomiHunt 备份文件');
    const cfg = parsed['tomihunt-llm-config'] as DirectLlmConfig | undefined;
    if (cfg) {
      providerEl.value = cfg.provider;
      modelEl.value = cfg.model ?? '';
      apiKeyEl.value = cfg.apiKey ?? '';
      baseUrlEl.value = cfg.baseUrl ?? '';
    }
    if (typeof parsed['tomihunt-resume'] === 'string') resumeEl.value = parsed['tomihunt-resume'];
    if (parsed['tomihunt-send-mode'] === 'auto') sendModeEl.value = 'auto';
    if (parsed['tomihunt-smart-reply'] === 'off') smartReplyEl.value = 'off';
    await chrome.storage.local.set(parsed);
    updateModelHint();
    showStatus(true, '✅ 已导入并恢复配置与简历。点「保存」再确认一次即可。');
  } catch (err) {
    showStatus(false, `❌ 导入失败: ${(err as Error).message}`);
  } finally {
    $('import-file').value = '';
  }
});


// --- Recovery: pull the resume back from a running local Core ---
// (The API key is intentionally never served back — copy it from
// ~/.tomi-job-hunt/config.json instead.)

$('recover-resume').addEventListener('click', async () => {
  showStatus(true, '正在从本地 Core 恢复简历…');
  try {
    const resp = await fetch('http://127.0.0.1:34567/setup/resume');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { exists: boolean; resume: string };
    if (!data.exists || !data.resume) throw new Error('本地 Core 中没有简历文件');
    resumeEl.value = data.resume;
    await chrome.storage.local.set({ 'tomihunt-resume': data.resume });
    showStatus(true, '✅ 已从本地 Core 恢复简历，记得点「保存」。');
  } catch (err) {
    showStatus(false, `恢复失败（Core 在运行吗？）: ${(err as Error).message}`);
  }
});

// Empty config + Core likely has it → show a recovery hint once.
void chrome.storage.local.get('tomihunt-llm-config').then(async (data) => {
  if (data['tomihunt-llm-config']) return; // extension config exists — nothing to hint
  try {
    const resp = await fetch('http://127.0.0.1:34567/setup/config');
    if (resp.ok) {
      showStatus(
        true,
        '检测到本地 Core 已配置（所以匹配分析能用）。当前插件实例的存储是空的——' +
          'API Key 请从 ~/.tomi-job-hunt/config.json 复制粘贴，简历点下方「从本地 Core 恢复简历」。',
      );
    }
  } catch {
    // Core offline — nothing to hint
  }
});

// Restore saved config + resume
void loadDirectConfig().then((cfg) => {
  if (!cfg) return;
  providerEl.value = cfg.provider;
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
  baseUrlEl.value = cfg.baseUrl ?? '';
  updateModelHint();
});
void chrome.storage.local.get(['tomihunt-resume', 'tomihunt-send-mode', 'tomihunt-smart-reply']).then((data) => {
  if (typeof data['tomihunt-resume'] === 'string') {
    resumeEl.value = data['tomihunt-resume'] as string;
  }
  if (data['tomihunt-send-mode'] === 'auto') {
    sendModeEl.value = 'auto';
  }
  if (data['tomihunt-smart-reply'] === 'off') {
    smartReplyEl.value = 'off';
  }
});
updateModelHint();
