/**
 * Options page — direct-mode LLM config (provider / model / API key).
 * Stored in chrome.storage.local; readable by content scripts.
 */
import { loadDirectConfig, presetFor, testDirectConnection, type DirectLlmConfig } from '../direct/llm.js';
import { parseResumeFile, ResumeParseError } from './resume-parser.js';

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
const resumeEl = $<HTMLTextAreaElement>('resume');
const resumeFileEl = $<HTMLInputElement>('resume-file');

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
  await chrome.storage.local.set({ 'tomihunt-llm-config': cfg });
  if (resumeEl.value.trim()) {
    await chrome.storage.local.set({ 'tomihunt-resume': resumeEl.value.trim() });
  }
  showStatus(true, '✅ 已保存（含简历）。现在打开 Boss 直聘岗位页即可使用。');
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

// Restore saved config + resume
void loadDirectConfig().then((cfg) => {
  if (!cfg) return;
  providerEl.value = cfg.provider;
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
  thinkingEl.checked = cfg.thinking === true;
  updateModelHint();
});
void chrome.storage.local.get('tomihunt-resume').then((data) => {
  if (typeof data['tomihunt-resume'] === 'string') {
    resumeEl.value = data['tomihunt-resume'] as string;
  }
});
updateModelHint();
