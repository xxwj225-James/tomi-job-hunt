/**
 * 模拟面试 tab — turn-based mock interview (direct/mock.ts). JD from a board
 * entry or pasted text; base resume from the options page. Transcript is
 * persisted under `tomihunt-mock-last` so a refresh survives.
 */
import { loadBoard } from '../direct/board.js';
import { loadResume } from '../direct/resume.js';
import { directMockInterviewTurn, directMockInterviewWrapUp } from '../direct/mock.js';
import type { MockTurn } from '../direct/mock.js';
import { esc, jdFromText } from './jd.js';
import type { WsJd } from './jd.js';

const MOCK_LAST_KEY = 'tomihunt-mock-last';

export function mountMock(): void {
  const jdSelect = document.getElementById('m-jd-select') as HTMLSelectElement;
  const jdText = document.getElementById('m-jd-text') as HTMLTextAreaElement;
  const titleEl = document.getElementById('m-title') as HTMLInputElement;
  const companyEl = document.getElementById('m-company') as HTMLInputElement;
  const startBtn = document.getElementById('m-start') as HTMLButtonElement;
  const transcriptEl = document.getElementById('m-transcript') as HTMLDivElement;
  const answerEl = document.getElementById('m-answer') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('m-send') as HTMLButtonElement;
  const endBtn = document.getElementById('m-end') as HTMLButtonElement;
  const restartBtn = document.getElementById('m-restart') as HTMLButtonElement;
  const wrapupEl = document.getElementById('m-wrapup') as HTMLDivElement;
  const statusEl = document.getElementById('m-status') as HTMLDivElement;

  let jd: WsJd | null = null;
  let history: MockTurn[] = [];
  let running = false;

  function setStatus(msg: string, kind: 'ok' | 'err'): void {
    statusEl.textContent = msg;
    statusEl.className = kind;
  }

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
    let base: WsJd | null = null;
    if (selId) {
      const entry = (await loadBoard()).find((e) => e.id === selId);
      if (entry) base = { title: entry.title, company: entry.company, salaryText: '', requirements: fromText.requirements, url: entry.url };
    } else if (fromText.requirements || fromText.title) {
      base = fromText;
    }
    if (!base) return null;
    const t = titleEl.value.trim();
    const c = companyEl.value.trim();
    return { ...base, title: t || base.title || '未知岗位', company: c || base.company };
  }

  function bubbleHtml(t: MockTurn): string {
    return `<div class="bubble ${t.speaker}">${esc(t.content)}</div>`;
  }

  function appendBubble(t: MockTurn): void {
    transcriptEl.insertAdjacentHTML('beforeend', bubbleHtml(t));
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function setRunning(on: boolean): void {
    running = on;
    startBtn.disabled = on;
    answerEl.disabled = !on;
    sendBtn.disabled = !on;
    endBtn.disabled = !on;
    restartBtn.classList.toggle('hidden', on || history.length === 0);
  }

  async function persist(): Promise<void> {
    try {
      await chrome.storage.local.set({ [MOCK_LAST_KEY]: { jd, history, running } });
    } catch {
      // storage unavailable — transcript stays in memory only
    }
  }

  async function askNext(): Promise<void> {
    if (!jd) return;
    try {
      const resume = await loadResume();
      const turn = await directMockInterviewTurn(jd, resume, history, history.length);
      history.push({ speaker: 'ai', content: turn.nextQuestion });
      const fb = turn.feedback ? `\n\n💡 ${turn.feedback}` : '';
      appendBubble({ speaker: 'ai', content: turn.nextQuestion + fb });
      await persist();
    } catch (err) {
      setStatus(`出题失败：${(err as Error).message}`, 'err');
      setRunning(false);
    }
  }

  startBtn.addEventListener('click', async () => {
    jd = await resolveJd();
    if (!jd) {
      setStatus('请先从看板选一个岗位，或粘贴 JD 原文。', 'err');
      return;
    }
    history = [];
    wrapupEl.classList.add('hidden');
    transcriptEl.innerHTML = '';
    setStatus('', 'ok');
    setRunning(true);
    await askNext();
  });

  sendBtn.addEventListener('click', () => {
    const text = answerEl.value.trim();
    if (!text) return;
    answerEl.value = '';
    history.push({ speaker: 'user', content: text });
    appendBubble({ speaker: 'user', content: text });
    void persist();
    void askNext();
  });

  endBtn.addEventListener('click', async () => {
    if (!jd || history.length === 0) return;
    try {
      const resume = await loadResume();
      const r = await directMockInterviewWrapUp(jd, resume, history);
      wrapupEl.innerHTML = `<b>📝 面试总结</b><div style="margin-top:6px">${esc(r.feedback)}</div><ul style="margin:8px 0 0 18px">${r.suggestions.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
      wrapupEl.classList.remove('hidden');
      setRunning(false);
    } catch (err) {
      setStatus(`总结失败：${(err as Error).message}`, 'err');
    }
  });

  restartBtn.addEventListener('click', async () => {
    history = [];
    transcriptEl.innerHTML = '';
    wrapupEl.classList.add('hidden');
    setStatus('', 'ok');
    setRunning(true);
    await askNext();
  });

  // Restore a persisted session on open.
  (async () => {
    try {
      const d = await chrome.storage.local.get(MOCK_LAST_KEY);
      const saved = d[MOCK_LAST_KEY] as { jd?: WsJd; history?: MockTurn[]; running?: boolean } | undefined;
      if (saved?.jd && saved.history?.length) {
        jd = saved.jd;
        history = saved.history;
        jdText.value = jd.requirements;
        titleEl.value = jd.title;
        companyEl.value = jd.company;
        transcriptEl.innerHTML = history.map(bubbleHtml).join('');
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
        setRunning(!!saved.running);
      }
    } catch {
      // no persisted session
    }
  })();

  void refreshJdSelect();
}
