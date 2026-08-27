/**
 * Popup: Core service health + usage hints. All heavy lifting happens in
 * content scripts; the popup is a status surface.
 */
import { CoreClient } from '../core-client.js';

const statusEl = document.getElementById('status');
if (!statusEl) throw new Error('popup: missing #status');

const client = new CoreClient();

async function refresh(): Promise<void> {
  try {
    const health = await client.health();
    statusEl.innerHTML = `
      <div class="row"><span>Core 服务</span><span class="ok">在线</span></div>
      <div class="row"><span>LLM Provider</span><span>${escapeHtml(health.provider)}</span></div>
      <div class="row"><span>队列</span><span>${health.queue.active} 运行中 / ${health.queue.pending} 排队</span></div>`;
  } catch {
    statusEl.innerHTML = `
      <div class="row"><span>Core 服务</span><span class="down">离线</span></div>
      <div class="row"><span>提示</span><span>运行 <code>npm run dev -w core</code></span></div>`;
  }
}

document.getElementById('open-options')?.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

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

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

void checkVersion();
void refresh();
setInterval(() => void refresh(), 5000);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
