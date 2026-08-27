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
const baseUrlEl = $<HTMLInputElement>('baseUrl');
const modelEl = $<HTMLInputElement>('model');
const apiKeyEl = $<HTMLInputElement>('apiKey');
const statusEl = $<HTMLDivElement>('status');
const modelHintEl = $<HTMLDivElement>('model-hint');
const baseUrlHintEl = $<HTMLDivElement>('baseUrl-hint');
const resumeEl = $<HTMLTextAreaElement>('resume');
const resumeFileEl = $<HTMLInputElement>('resume-file');
const sendModeEl = $<HTMLSelectElement>('sendMode');

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
  });
  if (resumeEl.value.trim()) {
    await chrome.storage.local.set({ 'tomihunt-resume': resumeEl.value.trim() });
  }
  showStatus(true, '✅ 已保存（含简历与发送方式）。现在打开 Boss 直聘岗位页即可使用。');
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
  baseUrlEl.value = cfg.baseUrl ?? '';
  updateModelHint();
});
void chrome.storage.local.get(['tomihunt-resume', 'tomihunt-send-mode']).then((data) => {
  if (typeof data['tomihunt-resume'] === 'string') {
    resumeEl.value = data['tomihunt-resume'] as string;
  }
  if (data['tomihunt-send-mode'] === 'auto') {
    sendModeEl.value = 'auto';
  }
});
updateModelHint();
