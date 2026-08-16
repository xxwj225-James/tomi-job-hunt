/**
 * Options page — direct-mode LLM config (provider / model / API key).
 * Stored in chrome.storage.local; readable by content scripts.
 */
import { loadDirectConfig, presetFor, testDirectConnection, type DirectLlmConfig } from '../direct/llm.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`options: missing #${id}`);
  return el as T;
};

const providerEl = $<HTMLSelectElement>('provider');
const modelEl = $<HTMLInputElement>('model');
const apiKeyEl = $<HTMLInputElement>('apiKey');
const thinkingEl = $<HTMLInputElement>('thinking');
const statusEl = $<HTMLDivElement>('status');
const modelHintEl = $<HTMLDivElement>('model-hint');

function showStatus(ok: boolean, message: string): void {
  statusEl.textContent = message;
  statusEl.className = ok ? 'ok' : 'err';
}

function updateModelHint(): void {
  const preset = presetFor(providerEl.value as DirectLlmConfig['provider']);
  if (preset) {
    modelHintEl.textContent = `默认: ${preset.defaultModel}（可留空）`;
    if (!modelEl.value) modelEl.placeholder = preset.defaultModel;
  } else {
    modelHintEl.textContent = '默认: claude-sonnet-5（可留空）';
    if (!modelEl.value) modelEl.placeholder = 'claude-sonnet-5';
  }
}

providerEl.addEventListener('change', updateModelHint);

async function buildConfig(): Promise<DirectLlmConfig> {
  const provider = providerEl.value as DirectLlmConfig['provider'];
  const preset = presetFor(provider);
  const cfg: DirectLlmConfig = {
    provider,
    model: modelEl.value.trim() || preset?.defaultModel || 'claude-sonnet-5',
    apiKey: apiKeyEl.value.trim(),
    thinking: thinkingEl.checked,
  };
  return cfg;
}

$('save').addEventListener('click', async () => {
  const cfg = await buildConfig();
  if (!cfg.apiKey) {
    showStatus(false, '请先填写 API Key');
    return;
  }
  await chrome.storage.local.set({ 'tomihunt-llm-config': cfg });
  showStatus(true, '✅ 已保存。现在打开 Boss 直聘岗位页即可使用。');
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

// Restore saved config
void loadDirectConfig().then((cfg) => {
  if (!cfg) return;
  providerEl.value = cfg.provider;
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
  thinkingEl.checked = cfg.thinking === true;
  updateModelHint();
});
updateModelHint();
