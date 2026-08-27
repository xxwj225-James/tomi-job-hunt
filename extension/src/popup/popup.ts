/**
 * Popup: Core service health + usage hints. All heavy lifting happens in
 * content scripts; the popup is a status surface.
 */
import { CoreClient } from '../core-client.js';

const statusEl = document.getElementById('status');
if (!statusEl) throw new Error('popup: missing #status');

const client = new CoreClient();

async function refresh(): Promise<void> {
  // Direct-mode config lives in chrome.storage.local; its presence decides
  // what the status area says when the local Core service is offline.
  let directProvider = '';
  try {
    const data = await chrome.storage.local.get('tomihunt-llm-config');
    directProvider = (data['tomihunt-llm-config'] as { provider?: string } | undefined)?.provider ?? '';
  } catch {
    // storage unavailable
  }

  try {
    const health = await client.health();
    statusEl.innerHTML = `
      <div class="row"><span>模式</span><span class="ok">完整模式</span></div>
      <div class="row"><span>Core 服务</span><span class="ok">在线</span></div>
      <div class="row"><span>LLM Provider</span><span>${escapeHtml(health.provider)}</span></div>`;
  } catch {
    if (directProvider) {
      statusEl.innerHTML = `
        <div class="row"><span>模式</span><span class="ok">直连模式</span></div>
        <div class="row"><span>LLM Provider</span><span>${escapeHtml(directProvider)}</span></div>
        <div class="row"><span>本地服务</span><span>不需要（进阶功能可选）</span></div>`;
    } else {
      statusEl.innerHTML = `
        <div class="row"><span>状态</span><span class="down">未配置</span></div>
        <div class="row"><span>下一步</span><span>点下方「⚙️ 设置」粘贴 API Key<br/>（无需启动任何服务）</span></div>`;
    }
  }
}

document.getElementById('open-options')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

// --- One-click Core launcher (tomihunt:// protocol registered by install-core.bat) ---
document.getElementById('start-core')?.addEventListener('click', () => {
  void startCore();
});

async function startCore(): Promise<void> {
  const hint = document.getElementById('core-hint');
  if (!hint) return;
  const button = document.getElementById('start-core') as HTMLButtonElement | null;
  try {
    // Already running?
    const health = await client.health();
    hint.style.display = 'block';
    hint.textContent = '✅ Core 已在运行（完整模式可用）';
    return;
  } catch {
    // not running — launch via protocol
  }
  if (button) button.disabled = true;
  hint.style.display = 'block';
  hint.textContent = '正在启动…（浏览器会询问一次「打开 TomiHunt」，请允许）';
  try {
    window.open('tomihunt://core/start', '_blank');
  } catch {
    // protocol handler not registered
  }
  // Poll /health for up to 40s (first run may need npm install)
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      await client.health();
      hint.textContent = '✅ 完整模式已启动，重新打开岗位页即可用全部功能';
      if (button) button.disabled = false;
      return;
    } catch {
      // still starting
    }
  }
  hint.textContent =
    '未检测到启动。首次使用需运行一次源码包里的 scripts\\install-core.bat 注册启动器（只需一次，之后这里一键启动）。';
  if (button) button.disabled = false;
}

// --- OTA version check (daily cache; unpacked installs can't self-update) ---
const VERSION_URL = 'https://raw.githubusercontent.com/<your-name>/tomi-job-hunt/main/version.json';
const UPDATE_EL_ID = 'update-hint';

async function checkVersion(): Promise<void> {
  const el = document.getElementById(UPDATE_EL_ID);
  if (!el) return;
  try {
    const { 'tomihunt-version-check': cached } = await chrome.storage.local.get('tomihunt-version-check');
    const last = cached as { at: number; latest: string } | undefined;
    const current = chrome.runtime.getManifest().version;
    const show = (message: string): void => {
      el.innerHTML = message;
      el.style.display = 'block';
    };
    if (last && Date.now() - last.at < 24 * 3600 * 1000) {
      if (compareVersions(last.latest, current) > 0) {
        show(`🆕 新版本 v${escapeHtml(last.latest)} 可用（当前 v${current}）——下载最新 Releases 并重新加载插件`);
      }
      return;
    }
    const resp = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!resp.ok) return;
    const json = (await resp.json()) as { version?: string };
    if (!json.version) return;
    await chrome.storage.local.set({ 'tomihunt-version-check': { at: Date.now(), latest: json.version } });
    if (compareVersions(json.version, current) > 0) {
      show(`🆕 新版本 v${escapeHtml(json.version)} 可用（当前 v${current}）——下载最新 Releases 并重新加载插件`);
    }
  } catch {
    // offline — silent
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

void checkVersion();
void refresh();
setInterval(() => void refresh(), 5000);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
