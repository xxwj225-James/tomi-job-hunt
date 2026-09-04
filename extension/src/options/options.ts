/**
 * Options page — direct-mode LLM config (provider / model / API key).
 * Stored in chrome.storage.local; readable by content scripts.
 */
import { loadDirectConfig, presetFor, testDirectConnection, type DirectLlmConfig } from '../direct/llm.js';
import { syncConfigToCore } from '../core-client.js';
import { decryptBackup, encryptBackup } from './backup-crypto.js';
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
const smartReplyEl = $<HTMLSelectElement>('smartReply');
const feedbackOptInEl = $<HTMLInputElement>('feedbackOptIn');
const storageHintEl = $<HTMLDivElement>('storage-hint');

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
    // send mode removed for compliance — the extension never auto-sends.
    'tomihunt-smart-reply': smartReplyEl.value === 'off' ? 'off' : 'on',
    'tomihunt-feedback-optin': feedbackOptInEl.checked,
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

// 连接测试已并入「保存」按钮：点保存即验证连接，无需单独的测试按钮。


// --- Config backup: export/import (survives folder changes & reinstalls) ---

// Fixed internal backup password — the file is AES-GCM encrypted
// (never plaintext) without burdening the user with password UX.
const backupPassword = (): string => 'tomihunt';

$('export').addEventListener('click', async () => {
  const data = await chrome.storage.local.get([
    'tomihunt-llm-config',
    'tomihunt-resume',
    'tomihunt-send-mode',
    'tomihunt-smart-reply',
  ]);
  const json = JSON.stringify({ tomihuntBackup: 1, savedAt: new Date().toISOString(), ...data }, null, 2);
  // The backup contains an API key — it is AES-256-GCM encrypted with the
  // backup password. The file on disk is never plaintext.
  const encrypted = await encryptBackup(json, backupPassword());
  const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tomihunt-backup.json';
  a.click();
  URL.revokeObjectURL(url);
  showStatus(true, '✅ 备份已加密下载（密码请务必记住，丢失无法恢复）。');
});

$('import').addEventListener('click', () => {
  $('import-file').click();
});

$('import-file').addEventListener('change', async () => {
  const file = $('import-file').files?.[0];
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text()) as Record<string, unknown>;
    let parsed: Record<string, unknown>;
    if (raw.format === 'tomihunt-backup-encrypted') {
      // Current format: password-encrypted (wrong password throws here)
      const plain = await decryptBackup(raw as never, backupPassword());
      parsed = JSON.parse(plain) as Record<string, unknown>;
      if (parsed.tomihuntBackup !== 1) throw new Error('不是 TomiHunt 备份文件');
    } else if (raw.tomihuntBackup === 1) {
      parsed = raw; // legacy plaintext backup — still accepted
    } else {
      throw new Error('不是 TomiHunt 备份文件（也不是加密备份）');
    }
    const cfg = parsed['tomihunt-llm-config'] as DirectLlmConfig | undefined;
    if (cfg) {
      providerEl.value = cfg.provider;
      modelEl.value = cfg.model ?? '';
      apiKeyEl.value = cfg.apiKey ?? '';
      baseUrlEl.value = cfg.baseUrl ?? '';
    }
    if (typeof parsed['tomihunt-resume'] === 'string') resumeEl.value = parsed['tomihunt-resume'];
    if (parsed['tomihunt-smart-reply'] === 'off') smartReplyEl.value = 'off';
    await chrome.storage.local.set(parsed);
    updateModelHint();

// --- Storage diagnostics: show the instance ID + what this instance holds ---
void (async () => {
  try {
    const data = await chrome.storage.local.get(null);
    const keys = Object.keys(data).filter((k) => k.startsWith('tomihunt-'));
    const id = chrome.runtime.id;
    if (keys.length === 0) {
      storageHintEl.textContent =
        `⚠️ 本插件实例（ID: ${id}）的存储是空的。` +
        '如果你之前在「另一个文件夹」加载过插件并保存过数据：数据还在那个旧实例里（开发模式下 Chrome 按加载目录识别插件）。' +
        '解决方法：回到旧文件夹加载 → 设置页「导出配置备份」→ 回到这里「导入配置备份」。';
    } else {
      storageHintEl.textContent = `插件实例 ID: ${id} · 本实例已存数据: ${keys.length} 项`;
    }
  } catch {
    // storage unavailable
  }
})();
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



// Empty config + Core likely has it → show a recovery hint once.
void chrome.storage.local.get('tomihunt-llm-config').then(async (data) => {
  if (data['tomihunt-llm-config']) return; // extension config exists — nothing to hint
  try {
    const resp = await fetch('http://127.0.0.1:34567/setup/config');
    if (resp.ok) {
      showStatus(
        true,
        '检测到本地 Core 已配置（所以匹配分析能用）。当前插件实例的存储是空的——' +
          'API Key 请从 ~/.tomi-job-hunt/config.json 复制粘贴，简历重新上传即可。',
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
void chrome.storage.local
  .get(['tomihunt-resume', 'tomihunt-smart-reply', 'tomihunt-feedback-optin'])
  .then((data) => {
    if (typeof data['tomihunt-resume'] === 'string') {
      resumeEl.value = data['tomihunt-resume'] as string;
    }
    if (data['tomihunt-smart-reply'] === 'off') {
      smartReplyEl.value = 'off';
    }
    // Default ON: only an explicit `false` (user un-ticked + saved) unchecks it.
    if (data['tomihunt-feedback-optin'] !== false) {
      feedbackOptInEl.checked = true;
    }
  });
updateModelHint();
