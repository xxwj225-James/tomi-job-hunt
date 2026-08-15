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

void refresh();
setInterval(() => void refresh(), 5000);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
