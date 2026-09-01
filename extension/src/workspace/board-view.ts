/**
 * 看板 tab — 5-status kanban over chrome.storage (direct/board.ts). Select to
 * move, delete with confirm, manual add form. No drag-n-drop in v1.
 */
import {
  addBoardEntry,
  deleteBoardEntry,
  loadBoard,
  moveBoardEntry,
  BOARD_STATUSES,
  BOARD_STATUS_LABELS,
} from '../direct/board.js';
import { esc } from './jd.js';

export function mountBoard(): void {
  const columns = document.getElementById('board-columns') as HTMLElement;
  const addBtn = document.getElementById('b-add') as HTMLButtonElement;

  async function render(): Promise<void> {
    const entries = await loadBoard();
    columns.innerHTML = BOARD_STATUSES.map((status) => {
      const items = entries.filter((e) => e.status === status);
      const cards = items
        .map(
          (e) => `
          <div class="card" data-id="${esc(e.id)}">
            <div class="t">${esc(e.title)}</div>
            <div class="c">${esc(e.company)}</div>
            ${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">打开</a>` : ''}
            ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
            ${e.pitch ? `<div class="note">💬 ${esc(e.pitch.slice(0, 50))}${e.pitch.length > 50 ? '…' : ''}</div>` : ''}
            <div class="foot">
              <select data-status>
                ${BOARD_STATUSES.map((s) => `<option value="${s}" ${s === e.status ? 'selected' : ''}>${BOARD_STATUS_LABELS[s]}</option>`).join('')}
              </select>
              <button data-del>删</button>
            </div>
          </div>`,
        )
        .join('');
      return `<div class="col"><h3>${BOARD_STATUS_LABELS[status]}（${items.length}）</h3>${cards || '<div class="muted">空</div>'}</div>`;
    }).join('');
  }

  columns.addEventListener('change', async (ev) => {
    const sel = (ev.target as HTMLElement | null)?.closest?.('select[data-status]');
    if (!sel || !columns.contains(sel)) return;
    const card = sel.closest('.card') as HTMLElement | null;
    if (!card) return;
    const status = (sel as HTMLSelectElement).value as (typeof BOARD_STATUSES)[number];
    await moveBoardEntry(card.dataset.id ?? '', status);
    await render();
  });

  columns.addEventListener('click', async (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest?.('button[data-del]');
    if (!btn || !columns.contains(btn)) return;
    const card = btn.closest('.card') as HTMLElement | null;
    if (!card) return;
    if (!confirm('删除这条投递记录？')) return;
    await deleteBoardEntry(card.dataset.id ?? '');
    await render();
  });

  addBtn.addEventListener('click', async () => {
    const company = (document.getElementById('b-company') as HTMLInputElement).value.trim();
    const title = (document.getElementById('b-title') as HTMLInputElement).value.trim();
    if (!company || !title) {
      alert('请填写公司与岗位。');
      return;
    }
    await addBoardEntry({
      status: (document.getElementById('b-status') as HTMLSelectElement).value as (typeof BOARD_STATUSES)[number],
      company,
      title,
      url: (document.getElementById('b-url') as HTMLInputElement).value.trim(),
      note: (document.getElementById('b-note') as HTMLInputElement).value.trim() || undefined,
      source: 'manual',
    });
    for (const id of ['b-company', 'b-title', 'b-url', 'b-note']) {
      (document.getElementById(id) as HTMLInputElement).value = '';
    }
    await render();
  });

  void render();
}
