/**
 * 简历版本 tab — per-JD tailored resume versions (direct/versions.ts) with
 * create / mark-applied / note / export .md / A/B compare. JD source: a board
 * entry or pasted JD text; the base resume comes from the options page.
 */
import { loadBoard } from '../direct/board.js';
import { loadResume } from '../direct/resume.js';
import { deleteVersion, loadVersions, markApplied, saveVersion } from '../direct/versions.js';
import type { ResumeVersion } from '../direct/versions.js';
import { directTailorResume } from '../direct/tailor.js';
import { esc, jdFromText, jdKey } from './jd.js';
import type { WsJd } from './jd.js';

export function mountVersions(): void {
  const jdSelect = document.getElementById('v-jd-select') as HTMLSelectElement;
  const jdText = document.getElementById('v-jd-text') as HTMLTextAreaElement;
  const resumeHint = document.getElementById('v-resume-hint') as HTMLDivElement;
  const createBtn = document.getElementById('v-create') as HTMLButtonElement;
  const list = document.getElementById('v-list') as HTMLDivElement;
  const compare = document.getElementById('v-compare') as HTMLDivElement;
  const aSel = document.getElementById('v-a') as HTMLSelectElement;
  const bSel = document.getElementById('v-b') as HTMLSelectElement;
  const aPre = document.getElementById('v-a-pre') as HTMLPreElement;
  const bPre = document.getElementById('v-b-pre') as HTMLPreElement;

  async function refreshJdSelect(): Promise<void> {
    const entries = await loadBoard();
    jdSelect.innerHTML =
      '<option value="">— 从看板选一个岗位（可选）—</option>' +
      entries
        .map((e) => `<option value="${esc(e.id)}">${esc(e.company)} · ${esc(e.title)}</option>`)
        .join('');
  }

  async function resolveJd(): Promise<WsJd | null> {
    const fromText = jdFromText(jdText.value);
    const selId = jdSelect.value;
    if (selId) {
      const entry = (await loadBoard()).find((e) => e.id === selId);
      if (entry) {
        return { title: entry.title, company: entry.company, salaryText: '', requirements: fromText.requirements, url: entry.url };
      }
    }
    return fromText.title || fromText.requirements ? fromText : null;
  }

  createBtn.addEventListener('click', async () => {
    const resume = await loadResume();
    if (!resume) {
      resumeHint.textContent = '未检测到本机简历：请先在 插件图标 → 设置 → 简历 里粘贴或上传简历，再来生成定制版。';
      return;
    }
    const jd = await resolveJd();
    if (!jd) {
      resumeHint.textContent = '请先选择看板岗位，或粘贴一段 JD 原文。';
      return;
    }
    createBtn.disabled = true;
    createBtn.textContent = 'AI 定制中…（约 5-15 秒）';
    try {
      const markdown = await directTailorResume(jd, resume);
      await saveVersion({
        jdKey: jdKey({ title: jd.title || '未知岗位', company: jd.company }),
        jdTitle: jd.title || '未知岗位',
        company: jd.company,
        markdown,
        createdBy: 'tailor',
      });
      resumeHint.textContent = '✅ 已生成并保存。';
      await render();
    } catch (err) {
      resumeHint.textContent = `生成失败：${(err as Error).message}`;
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = '生成本岗位定制简历';
    }
  });

  function vItem(v: ResumeVersion): string {
    const applied = v.appliedAt
      ? `<span class="badge">已投递 ${new Date(v.appliedAt).toLocaleDateString()}</span>`
      : '';
    return `
      <div class="v-item" data-id="${esc(v.id)}">
        <div class="head">
          <b>v${v.version}</b>
          <span class="muted">${v.createdBy === 'tailor' ? 'AI 定制' : '手动'}</span>
          ${applied}
          ${v.note ? `<span class="muted">${esc(v.note)}</span>` : ''}
        </div>
        <pre>${esc(v.markdown.slice(0, 600))}${v.markdown.length > 600 ? '\n…（展开省略）' : ''}</pre>
        <div class="ops">
          <button data-act="applied">标记已投递</button>
          <button data-act="note" class="secondary">备注</button>
          <button data-act="export" class="secondary">导出 .md</button>
          <button data-act="del" class="secondary">删除</button>
        </div>
      </div>`;
  }

  async function render(): Promise<void> {
    const versions = await loadVersions();
    const groups = new Map<string, ResumeVersion[]>();
    for (const v of versions) {
      const arr = groups.get(v.jdKey) ?? [];
      arr.push(v);
      groups.set(v.jdKey, arr);
    }
    list.innerHTML =
      groups.size > 0
        ? [...groups.entries()]
            .map(
              ([, vs]) => `<div class="group">
                <h3>${esc(vs[0]!.jdTitle)} @ ${esc(vs[0]!.company)}（${vs.length} 版）</h3>
                ${vs.map(vItem).join('')}
              </div>`,
            )
            .join('')
        : '<div class="muted">还没有简历版本。上方选一个岗位 / 贴 JD，生成第一份定制简历。</div>';

    aSel.innerHTML = '<option value="">版本 A</option>' + versions.map((v) => `<option value="${v.id}">${esc(v.jdTitle)} v${v.version}</option>`).join('');
    bSel.innerHTML = '<option value="">版本 B</option>' + versions.map((v) => `<option value="${v.id}">${esc(v.jdTitle)} v${v.version}</option>`).join('');
  }

  function wireCompare(): void {
    const show = (): void => {
      compare.classList.remove('hidden');
      const pick = async (id: string, pre: HTMLPreElement): Promise<void> => {
        const v = (await loadVersions()).find((x) => x.id === id);
        pre.textContent = v ? v.markdown : '（选择版本）';
      };
      void pick(aSel.value, aPre);
      void pick(bSel.value, bPre);
    };
    aSel.addEventListener('change', show);
    bSel.addEventListener('change', show);
  }

  list.addEventListener('click', async (ev) => {
    const btn = (ev.target as HTMLElement | null)?.closest?.('button[data-act]');
    if (!btn || !list.contains(btn)) return;
    const item = btn.closest('.v-item') as HTMLElement | null;
    const id = item?.dataset.id ?? '';
    const act = (btn as HTMLElement).dataset.act;
    const all = await loadVersions();
    const v = all.find((x) => x.id === id);

    if (act === 'applied' && v) {
      await markApplied(id);
      await render();
    } else if (act === 'note' && v) {
      const note = prompt('备注（可选）', v.note ?? '');
      if (note === null) return;
      await saveVersion({ ...v, note: note.trim() || undefined });
      await render();
    } else if (act === 'export' && v) {
      const blob = new Blob([v.markdown], { type: 'text/markdown;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${v.jdTitle.replace(/[/\\:]/g, '_')}-v${v.version}.md`;
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (act === 'del' && v) {
      if (!confirm(`删除 ${v.jdTitle} v${v.version}？`)) return;
      await deleteVersion(id);
      await render();
    }
  });

  void refreshJdSelect();
  wireCompare();
  void render();
}
