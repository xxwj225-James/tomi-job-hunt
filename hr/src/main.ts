/**
 * HR screening page wiring — JD paste → batch resume upload → local parse →
 * LLM scoring (user-initiated, concurrency-bounded) → ranked verdict cards.
 * Also: DeepSeek key guide, and an offline HR-needs collector (localStorage +
 * copy/export — sent back to the author manually until a cloud agent exists).
 */
import { loadConfig, saveConfig, testConnection, presetFor } from './llm.js';
import type { HrLlmConfig } from './llm.js';
import { parseResumeFile } from './parser.js';
import { candidateNameFromFile, jdFromText, screenBatch, screenCandidate } from './screen.js';
import type { HrJd, ScreenCandidate, ScreenOutcome } from './screen.js';

const FEEDBACK_KEY = 'tomihunt-hr-feedback';
const HR_FEEDBACK_OPTIN_KEY = 'tomihunt-hr-feedback-optin';

/**
 * 反馈上报端点 —— 与 extension/src/direct/feedback.ts 的 FEEDBACK_ENDPOINT 保持同步。
 * hr/ 是独立 Vite root，不可跨项目 import，故复制常量。复用 tomatovector.com
 * 反馈系统（服务端独立表 tomihunt_feedback，admin 后台查看）。留空 = 不上传。
 * 公开 URL 不含凭证，可安全 commit。
 */
const FEEDBACK_ENDPOINT = 'https://tomatovector.com/api/tomihunt-feedback';

const NEED_TAGS: Array<[string, string]> = [
  ['hard-fit', '硬性要求精确匹配'],
  ['salary', '期望薪资匹配'],
  ['custom-rule', '自定义筛选规则'],
  ['online-analyze', '在线简历分析（招聘平台简历页直接分析）'],
  ['export-excel', '导出 Excel'],
  ['more-fields', '更多简历字段展示'],
  ['speed', '希望更快'],
  ['accuracy', '评分更准'],
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function $<T extends HTMLElement>(sel: string): T {
  return document.querySelector(sel) as T;
}

// --- config form ---
const providerEl = $<HTMLSelectElement>('#provider');
const baseUrlEl = $<HTMLInputElement>('#baseUrl');
const modelEl = $<HTMLInputElement>('#model');
const apiKeyEl = $<HTMLInputElement>('#apiKey');
const statusEl = $<HTMLDivElement>('#status');

function showStatus(msg: string, kind: 'ok' | 'err'): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

function applyPreset(): void {
  const preset = presetFor(providerEl.value as HrLlmConfig['provider']);
  baseUrlEl.value = preset?.baseUrl ?? '';
  modelEl.value = preset?.defaultModel ?? '';
}

function readConfig(): HrLlmConfig {
  return {
    provider: providerEl.value as HrLlmConfig['provider'],
    model: modelEl.value.trim(),
    apiKey: apiKeyEl.value.trim(),
    baseUrl: baseUrlEl.value.trim() || undefined,
  };
}

function fillConfigForm(cfg: HrLlmConfig | null): void {
  if (!cfg) return;
  providerEl.value = cfg.provider;
  baseUrlEl.value = cfg.baseUrl ?? '';
  modelEl.value = cfg.model;
  apiKeyEl.value = cfg.apiKey;
}

providerEl.addEventListener('change', applyPreset);
$('#save').addEventListener('click', async () => {
  const cfg = readConfig();
  if (!cfg.apiKey) {
    showStatus('请先填写 API Key。', 'err');
    return;
  }
  saveConfig(cfg);
  showStatus('已保存，正在测试连接…', 'ok');
  const r = await testConnection(cfg);
  showStatus(r.ok ? `✅ 已保存；连接测试通过（${r.message}）` : `⚠️ 已保存，但连接测试失败：${r.message}`, r.ok ? 'ok' : 'err');
});

// --- JD input ---
const jdTextEl = $<HTMLTextAreaElement>('#jdText');
const jdTitleEl = $<HTMLInputElement>('#jdTitle');
const jdCompanyEl = $<HTMLInputElement>('#jdCompany');
const jdSalaryEl = $<HTMLInputElement>('#jdSalary');
const jdPreviewEl = $<HTMLDivElement>('#jdPreview');

function currentJd(): HrJd {
  const parsed = jdFromText(jdTextEl.value);
  return {
    title: jdTitleEl.value.trim() || parsed.title || '未知岗位',
    company: jdCompanyEl.value.trim() || parsed.company,
    salaryText: jdSalaryEl.value.trim() || parsed.salaryText,
    requirements: jdTextEl.value.trim(),
  };
}

jdTextEl.addEventListener('input', () => {
  const parsed = jdFromText(jdTextEl.value);
  if (!jdTitleEl.value.trim()) jdTitleEl.value = parsed.title;
  if (!jdCompanyEl.value.trim()) jdCompanyEl.value = parsed.company;
  if (!jdSalaryEl.value.trim()) jdSalaryEl.value = parsed.salaryText;
  jdPreviewEl.textContent = parsed.requirements
    ? `自动解析：岗位「${parsed.title || '未识别'}」${parsed.company ? ' @ ' + parsed.company : ''}${parsed.salaryText ? ' · ' + parsed.salaryText : ''}（解析不准可在上方手动修改）`
    : '';
});

// --- file selection ---
const filesInputEl = $<HTMLInputElement>('#files');
const fileListEl = $<HTMLDivElement>('#fileList');
const startBtn = $<HTMLButtonElement>('#start');
const progressEl = $<HTMLDivElement>('#progress');
const progressBarEl = $<HTMLDivElement>('#progressBar');
const progressTextEl = $<HTMLDivElement>('#progressText');
const resultSectionEl = $<HTMLElement>('#resultSection');
const resultsEl = $<HTMLDivElement>('#results');

function fileStatusLabel(name: string, label: string, kind?: 'done' | 'err'): void {
  const row = fileListEl.querySelector(`[data-name="${CSS.escape(name)}"] .st`);
  if (!row) return;
  row.textContent = label;
  if (kind) row.classList.add(kind);
}

filesInputEl.addEventListener('change', () => {
  fileListEl.innerHTML = '';
  for (const f of filesInputEl.files ?? []) {
    const item = document.createElement('div');
    item.className = 'file-item';
    item.dataset.name = f.name;
    item.innerHTML = `<span>${esc(f.name)}</span><span class="st">${(f.size / 1024).toFixed(0)} KB</span>`;
    fileListEl.append(item);
  }
});

function setProgress(visible: boolean, frac = 0): void {
  progressEl.classList.toggle('hidden', !visible);
  progressBarEl.style.width = `${Math.round(frac * 100)}%`;
}

/** Bounded-concurrency pool for local parsing (pdfjs memory). */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

interface LastBatch {
  jd: HrJd;
  candidates: ScreenCandidate[];
  outcomes: ScreenOutcome[];
}
let lastBatch: LastBatch | null = null;

startBtn.addEventListener('click', async () => {
  const cfg = loadConfig();
  if (!cfg) {
    showStatus('请先在第 ① 步保存 API Key。', 'err');
    return;
  }
  const jd = currentJd();
  if (!jd.requirements) {
    showStatus('请先在第 ② 步粘贴 JD 原文。', 'err');
    return;
  }
  const files = Array.from(filesInputEl.files ?? []);
  if (files.length === 0) {
    showStatus('请先在第 ③ 步选择简历文件。', 'err');
    return;
  }
  const n = files.length;
  const estSec = Math.max(5, Math.ceil(n / 4) * 4);
  if (!confirm(`将调用 ${n} 次模型接口为每份简历打分（约 ${estSec} 秒），费用由你的 API Key 承担。继续？`)) {
    return;
  }

  startBtn.disabled = true;
  resultSectionEl.classList.add('hidden');
  setProgress(true, 0);

  try {
    // Phase 1: parse all files locally (pool 3)
    const candidates: ScreenCandidate[] = [];
    let parsedCount = 0;
    progressTextEl.textContent = '解析简历文件…';
    await runPool(files, 3, async (file) => {
      try {
        const text = await parseResumeFile(file);
        candidates.push({ name: candidateNameFromFile(file.name), text });
        fileStatusLabel(file.name, '✅ 已解析', 'done');
      } catch (err) {
        fileStatusLabel(file.name, `❌ ${(err as Error).message}`, 'err');
      }
      parsedCount += 1;
      progressTextEl.textContent = `解析 ${parsedCount}/${n}`;
      setProgress(true, parsedCount / n);
    });

    if (candidates.length === 0) {
      showStatus('没有可打分的简历。请检查解析失败的文件（扫描件 PDF 或 .doc 需转格式）。', 'err');
      return;
    }

    // Phase 2: LLM scoring (pool 4), then ranked render
    let doneCount = 0;
    progressTextEl.textContent = 'AI 打分中…';
    const outcomes = await screenBatch(cfg, jd, candidates, {
      onProgress: (done, total) => {
        doneCount = done;
        progressTextEl.textContent = `AI 打分 ${done}/${total}（失败单份自动跳过）`;
        setProgress(true, done / total);
      },
    });
    progressTextEl.textContent = `完成：${outcomes.length}/${candidates.length} 份打分成功`;
    setProgress(false, 1);

    lastBatch = { jd, candidates, outcomes };
    renderResults(outcomes);
    resultSectionEl.classList.remove('hidden');
    resultSectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    startBtn.disabled = false;
  }
});

function renderResults(outcomes: ScreenOutcome[]): void {
  resultsEl.innerHTML = '';
  const cfg = loadConfig();
  outcomes.forEach((o, idx) => {
    const card = document.createElement('div');
    card.className = 'card';
    const badgeCls =
      o.verdict === '约面' ? 'yuemian' : o.verdict === '待定' ? 'daiding' : o.verdict === '婉拒' ? 'wanjue' : '';
    const scoreHtml =
      o.score !== null ? `<span class="score">${o.score}</span>` : `<span class="score" style="color:#bbb">未评分</span>`;
    const badgeHtml = o.verdict ? `<span class="badge ${badgeCls}">${esc(o.verdict)}</span>` : '';
    const chipHtml = o.verdictLabel ? `<span class="chip">${esc(o.verdictLabel)}</span>` : '';
    const strengths = o.strengths.map((s) => `<div class="s">✅ ${esc(s)}</div>`).join('');
    const gaps = o.gaps.map((g) => `<div class="g">⚠️ ${esc(g)}</div>`).join('');
    const risks = o.risks.map((r) => `<div class="r">🚨 ${esc(r)}</div>`).join('');
    const errHtml = o.error ? `<div class="err">${esc(o.error)}</div>` : '';
    const resumeText = lastBatch?.candidates[idx]?.text ?? '';
    const detailHtml = `<div class="detail hidden">${esc(resumeText.slice(0, 800))}</div>`;

    card.innerHTML = `
      <div class="card-head">
        <span class="rank">#${idx + 1}</span>
        <b>${esc(o.name)}</b>
        ${scoreHtml}
        ${badgeHtml}
        ${chipHtml}
        <span class="ms">${o.ms}ms</span>
        <button class="secondary" data-toggle style="padding:4px 10px;font-size:12px">详情</button>
        ${o.error ? `<button class="secondary" data-retry style="padding:4px 10px;font-size:12px">重试</button>` : ''}
      </div>
      <div class="reasons">${strengths}${gaps}${risks}</div>
      ${errHtml}
      ${detailHtml}`;
    resultsEl.append(card);

    const toggleBtn = card.querySelector('[data-toggle]');
    toggleBtn?.addEventListener('click', () => {
      const d = card.querySelector('.detail');
      const hidden = d?.classList.toggle('hidden');
      toggleBtn.textContent = hidden ? '详情' : '收起';
    });
    card.querySelector('[data-retry]')?.addEventListener('click', async (e) => {
      if (!cfg || !lastBatch) return;
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = '重新打分中…';
      const outcome = await screenCandidate(cfg, lastBatch.jd, lastBatch.candidates[idx]!);
      lastBatch.outcomes[idx] = outcome;
      renderResults([...lastBatch.outcomes].sort(byScore));
    });
  });
}

function byScore(a: ScreenOutcome, b: ScreenOutcome): number {
  return (b.score ?? -1) - (a.score ?? -1);
}

// --- HR needs collector ---
const needTagsEl = $<HTMLDivElement>('#needTags');
const needNoteEl = $<HTMLTextAreaElement>('#needNote');

function renderNeedTags(): void {
  needTagsEl.innerHTML = '';
  for (const [id, label] of NEED_TAGS) {
    const labelEl = document.createElement('label');
    labelEl.innerHTML = `<input type="checkbox" value="${id}" /><span>${esc(label)}</span>`;
    needTagsEl.append(labelEl);
  }
}

function selectedTags(): string[] {
  return Array.from(needTagsEl.querySelectorAll<HTMLInputElement>('input:checked')).map((i) => i.value);
}

function loadFeedback(): Array<{ ts: number; tags: string[]; note: string }> {
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? (JSON.parse(raw) as Array<{ ts: number; tags: string[]; note: string }>) : [];
  } catch {
    return [];
  }
}

function tagLabel(id: string): string {
  return NEED_TAGS.find(([k]) => k === id)?.[1] ?? id;
}

function buildFeedbackText(): string {
  const curTags = selectedTags().map(tagLabel).join('、');
  const curNote = needNoteEl.value.trim();
  const all = loadFeedback();
  const lines = [
    '【TomiHunt HR 版 — 使用需求反馈】',
    curTags ? `本次需求：${curTags}` : '',
    curNote ? `说明：${curNote}` : '',
    '',
    ...(all.length > 0 ? ['【历史反馈】'] : []),
    ...all.map((f) => `[${new Date(f.ts).toLocaleString()}] ${f.tags.map(tagLabel).join('、')}${f.note ? ` — ${f.note}` : ''}`),
  ];
  return lines.filter(Boolean).join('\n');
}

$('#feedbackSave').addEventListener('click', () => {
  const tags = selectedTags();
  const note = needNoteEl.value.trim();
  if (tags.length === 0 && !note) {
    showStatus('请至少勾选一项需求，或填写说明。', 'err');
    return;
  }
  const all = loadFeedback();
  all.push({ ts: Date.now(), tags, note });
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(all.slice(-100)));
  needNoteEl.value = '';
  for (const cb of needTagsEl.querySelectorAll<HTMLInputElement>('input')) cb.checked = false;
  // Opt-in anonymous upload (fire-and-forget; silently skipped on failure).
  const optInEl = document.getElementById('feedbackOptIn') as HTMLInputElement | null;
  if (FEEDBACK_ENDPOINT && optInEl?.checked) {
    void fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature: 'hr-needs', ts: Date.now(), tags, note }),
    }).catch(() => {});
    localStorage.setItem(HR_FEEDBACK_OPTIN_KEY, '1');
    showStatus('已保存，并匿名上传反馈（感谢！）。', 'ok');
    return;
  }
  // Persist the opt-out too, so an explicit un-check sticks across reloads.
  localStorage.setItem(HR_FEEDBACK_OPTIN_KEY, optInEl?.checked ? '1' : '0');
  showStatus('已保存到本机。可点「复制反馈」后发给作者。', 'ok');
});

// Restore the opt-in checkbox: default ON; only an explicit '0' opt-out unchecks it.
const hrOptInEl = document.getElementById('feedbackOptIn') as HTMLInputElement | null;
if (hrOptInEl && localStorage.getItem(HR_FEEDBACK_OPTIN_KEY) === '0') {
  hrOptInEl.checked = false;
}

$('#feedbackCopy').addEventListener('click', async () => {
  const text = buildFeedbackText();
  try {
    await navigator.clipboard.writeText(text);
    showStatus('已复制，可直接粘贴发给作者。', 'ok');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showStatus('已复制，可直接粘贴发给作者。', 'ok');
  }
});

$('#feedbackExport').addEventListener('click', () => {
  const all = loadFeedback();
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tomihunt-hr-feedback.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- boot ---
fillConfigForm(loadConfig());
renderNeedTags();
