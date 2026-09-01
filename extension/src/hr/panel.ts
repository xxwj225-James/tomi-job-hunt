/**
 * HR 在线简历分析浮动面板 — job-seeker extension's HR counterpart.
 * Floating button → panel with two modes:
 *   - config: HR's own API key (`tomihunt-hr-llm-config`), tested inline
 *   - analyze: paste JD + candidate resume (or extract from page) → score
 * Result shows deterministic verdict (约面/待定/婉拒 via score.ts) plus
 * strengths/gaps/risks. 「复制页面文本」is the snapshot collector we use to
 * build the real platform selectors once the user shares a real HR page.
 *
 * 列表页（如猎聘「搜索人才」）经 `extractCandidates` 返回多位候选人：面板提供
 * 候选人下拉（选中即填充简历）＋「全部速筛」（同一 JD 逐位打分，出结果徽章表）。
 */
import { presetFor } from '../direct/llm.js';
import type { DirectLlmConfig, DirectProviderId } from '../direct/llm.js';
import { loadHrConfig, saveHrConfig, testHrConnection } from './config.js';
import { jdFromText } from '../workspace/jd.js';
import { hrVerdictColor } from './score.js';
import type { HrAnalysisResult, HrJdLike } from './analyze.js';
import { candidateToText } from './resume-extract.js';
import type { LiepinCandidate } from './resume-extract.js';

export interface HrPanelApi {
  /** Extract candidate resume text from the current page; '' if none found. */
  extractPageText(): string;
  /** Extract structured candidates (list page); optional — detail pages skip. */
  extractCandidates?(): LiepinCandidate[];
  /** Copy the current page's visible text to the clipboard (snapshot collector). */
  copyPageText(): Promise<void>;
  /** Run the analysis; throws on LLM/parse failure. */
  onAnalyze(jd: HrJdLike, resume: string): Promise<HrAnalysisResult>;
}

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; font-family: system-ui, "Microsoft YaHei", sans-serif; }
.btn { padding: 10px 16px; border-radius: 20px; border: 0; cursor: pointer; font-size: 13px; font-weight: 600; color: #fff; background: linear-gradient(135deg, #4f7cff, #6a5cff); box-shadow: 0 4px 14px rgba(80,90,220,.35); }
.btn.secondary { background: #f0f2f7; color: #333; box-shadow: none; }
.panel { margin-top: 10px; width: 360px; max-height: 540px; overflow-y: auto; background: #fff; color: #222; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18); padding: 14px; font-size: 13px; line-height: 1.55; display: none; }
.panel.open { display: block; }
.h { font-weight: 700; margin-bottom: 4px; }
.sub { color: #666; font-size: 12px; margin-bottom: 8px; }
label { display: block; font-size: 12px; color: #555; margin: 8px 0 3px; }
input, textarea, select { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid #d0d5dd; border-radius: 8px; font: inherit; font-size: 13px; }
textarea { resize: vertical; }
.row { display: flex; gap: 6px; margin-top: 6px; }
.row button { flex: 1; padding: 7px 0; border: 0; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; color: #fff; background: #4f7cff; }
.row button.sec { background: #f0f2f7; color: #333; }
.busy { color: #4f7cff; font-size: 12px; margin-top: 8px; }
.result { margin-top: 10px; border-top: 1px solid #f0f0f0; padding-top: 8px; }
.badge { display: inline-block; padding: 3px 12px; border-radius: 14px; color: #fff; font-weight: 700; font-size: 15px; }
.score { font-size: 22px; font-weight: 800; }
.sec { margin-top: 8px; }
.sec b { display: block; margin-bottom: 2px; }
.sec ul { margin: 0 0 0 18px; padding: 0; }
.batch-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.batch-row .badge { font-size: 12px; padding: 2px 10px; }
.batch-row b { width: 30px; text-align: right; }
.batch-row .who { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #333; }
.status { margin-top: 8px; padding: 7px 9px; border-radius: 8px; font-size: 12px; display: none; }
.status.ok { display: block; background: #f0fdf4; color: #1a7f37; }
.status.err { display: block; background: #fef2f2; color: #c0392b; }
details { margin-top: 8px; font-size: 11px; color: #777; }
`;

let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;

let mode: 'main' | 'config' = 'main';
let result: HrAnalysisResult | null = null;
let busy = false;
let feedbackMsg: { kind: 'ok' | 'err'; text: string } | null = null;

// Persisted form state (re-render rebuilds innerHTML — values must survive).
let jdText = '';
let resumeText = '';
let candidates: LiepinCandidate[] = [];
let sel = 0;
let batchResults: (LiepinCandidate & { result: HrAnalysisResult | null; error?: string })[] | null = null;

function ensure(): ShadowRoot {
  if (shadow) return shadow;
  host = document.createElement('div');
  host.id = 'tomihunt-hr-panel-host';
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.append(style);
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <button class="btn" id="tomi-hr-toggle">🤖 TomiHunt HR</button>
    <div class="panel" id="tomi-hr-panel"></div>`;
  shadow.append(wrap);
  (document.body ?? document.documentElement).append(host);
  return shadow;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cfgStatus(cfg: DirectLlmConfig | null): string {
  return cfg ? `已配置：${cfg.provider} · ${cfg.model}` : '未配置（HR 需要自己的 API Key）';
}

function buildJd(jdRaw: string): HrJdLike {
  const parsed = jdFromText(jdRaw || '\n');
  return {
    title: jdRaw ? parsed.title || '未知岗位' : '未提供岗位',
    company: parsed.company,
    salaryText: parsed.salaryText,
    requirements: jdRaw || '（HR 未提供 JD，按简历通用评估）',
  };
}

export async function mountHrPanel(api: HrPanelApi): Promise<void> {
  const s = ensure();
  const toggle = s.querySelector('#tomi-hr-toggle') as HTMLButtonElement;
  const panel = s.querySelector('#tomi-hr-panel') as HTMLElement;
  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) void render(api, panel);
  });
  await render(api, panel);
}

async function render(api: HrPanelApi, panel: HTMLElement): Promise<void> {
  const cfg = await loadHrConfig();
  const cfgLine = `<div class="sub">${esc(cfgStatus(cfg))} · <a href="#" data-act="open-config" style="color:#4f7cff">${mode === 'config' ? '' : '配置'}</a></div>`;

  if (mode === 'config') {
    const p = cfg?.provider ?? 'deepseek';
    const preset = presetFor(p);
    const status = feedbackMsg ? `<div class="status ${feedbackMsg.kind}">${esc(feedbackMsg.text)}</div>` : '';
    panel.innerHTML = `
      <div class="h">⚙️ HR 简历分析 · 配置</div>
      ${cfgLine}
      <label>服务商</label>
      <select data-k="provider">
        <option value="deepseek" ${p === 'deepseek' ? 'selected' : ''}>DeepSeek（推荐）</option>
        <option value="qwen" ${p === 'qwen' ? 'selected' : ''}>通义千问 Qwen</option>
        <option value="kimi" ${p === 'kimi' ? 'selected' : ''}>Kimi（月之暗面）</option>
        <option value="generic" ${p === 'generic' ? 'selected' : ''}>通用（自填 OpenAI 兼容地址）</option>
      </select>
      <label>模型（默认填最新模型）</label>
      <input data-k="model" value="${esc(cfg?.model ?? preset?.defaultModel ?? '')}" placeholder="${esc(preset?.defaultModel ?? '')}" />
      <label>API Key</label>
      <input data-k="apiKey" type="password" value="${esc(cfg?.apiKey ?? '')}" placeholder="sk-..." />
      <label>Base URL（通用必填）</label>
      <input data-k="baseUrl" value="${esc(cfg?.baseUrl ?? '')}" placeholder="${esc(preset?.baseUrl ?? 'https://xxx/v1')}" />
      <div class="row">
        <button data-act="test-config" class="sec">测试连接</button>
        <button data-act="save-config">保存</button>
        <button data-act="back" class="sec">返回</button>
      </div>
      ${status}
      <details><summary>DeepSeek 如何申请 Key？</summary>
        platform.deepseek.com → 手机号登录 → 实名认证 → 充值 ¥10-20（不退款）→ API keys → 创建 → 复制 sk-。</details>`;
    const read = (): DirectLlmConfig => ({
      provider: (panel.querySelector('[data-k="provider"]') as HTMLSelectElement).value as DirectProviderId,
      model: (panel.querySelector('[data-k="model"]') as HTMLInputElement).value.trim(),
      apiKey: (panel.querySelector('[data-k="apiKey"]') as HTMLInputElement).value.trim(),
      baseUrl: (panel.querySelector('[data-k="baseUrl"]') as HTMLInputElement).value.trim() || undefined,
    });
    panel.querySelector('[data-act="test-config"]')?.addEventListener('click', async () => {
      feedbackMsg = null;
      await render(api, panel);
      const r = await testHrConnection(read());
      feedbackMsg = { kind: r.ok ? 'ok' : 'err', text: r.message };
      await render(api, panel);
    });
    panel.querySelector('[data-act="save-config"]')?.addEventListener('click', async () => {
      feedbackMsg = null;
      const c = read();
      if (!c.apiKey) {
        feedbackMsg = { kind: 'err', text: '请填写 API Key。' };
        await render(api, panel);
        return;
      }
      await saveHrConfig(c);
      mode = 'main';
      await render(api, panel);
    });
    panel.querySelector('[data-act="open-config"]')?.addEventListener('click', (e) => e.preventDefault());
    panel.querySelector('[data-act="back"]')?.addEventListener('click', () => {
      mode = 'main';
      void render(api, panel);
    });
    return;
  }

  const status = feedbackMsg ? `<div class="status ${feedbackMsg.kind}">${esc(feedbackMsg.text)}</div>` : '';
  const busyHtml = busy ? '<div class="busy">⏳ 正在分析（约 5-15 秒/位）…</div>' : '';
  const resultHtml = result
    ? `<div class="result">
        <div><span class="badge" style="background:${hrVerdictColor(result.verdict)}">${esc(result.verdict)}</span>
        <span class="score">${result.score}</span><span style="color:#888;font-size:12px">/100</span></div>
        ${result.strengths.length ? `<div class="sec"><b>✅ 匹配优势</b><ul>${result.strengths.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${result.gaps.length ? `<div class="sec"><b>⚠️ 短板</b><ul>${result.gaps.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${result.risks.length ? `<div class="sec"><b>🚨 风险点</b><ul>${result.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      </div>`
    : '';

  const candidatePicker = candidates.length
    ? `<label>候选人（列表页提取 ${candidates.length} 位，选中即填充简历）</label>
       <select data-k="candidate">
         ${candidates
           .map(
             (c, i) =>
               `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(c.name || '未知')} · ${esc(c.expectTitle || '')} · ${esc(c.expectSalary || '')}</option>`,
           )
           .join('')}
       </select>
       <div class="row"><button data-act="batch" class="sec">⚡ 全部速筛（${candidates.length} 位）</button></div>`
    : '';

  const batchHtml = batchResults
    ? `<div class="result"><b>⚡ 全部速筛结果</b>
        ${batchResults
          .map((r) => {
            if (!r.result) {
              return `<div class="batch-row"><span class="who">${esc(r.name)}</span><span style="color:#c0392b;font-size:12px">失败：${esc(r.error ?? '')}</span></div>`;
            }
            return `<div class="batch-row"><span class="badge" style="background:${hrVerdictColor(r.result.verdict)}">${esc(r.result.verdict)}</span><b>${r.result.score}</b><span class="who">${esc(r.name)} · ${esc(r.expectTitle || '')}</span></div>`;
          })
          .join('')}
      </div>`
    : '';

  panel.innerHTML = `
    <div class="h">🤖 TomiHunt HR · 简历分析</div>
    ${cfgLine}
    <label>目标 JD（粘贴或从岗位详情页复制；留空则仅看简历）</label>
    <textarea data-k="jd" rows="4" placeholder="粘贴岗位 JD 原文…">${esc(jdText)}</textarea>
    <label>候选人简历</label>
    <textarea data-k="resume" rows="7" placeholder="从页面提取，或手动粘贴候选人简历…">${esc(resumeText)}</textarea>
    <div class="row">
      <button data-act="extract">从页面提取</button>
      <button data-act="copy" class="sec">复制页面文本</button>
    </div>
    <div class="row">
      <button data-act="analyze">开始分析</button>
    </div>
    ${candidatePicker}
    ${busyHtml}
    ${resultHtml}
    ${batchHtml}
    ${status}
    <div class="sub" style="margin-top:8px">「复制页面文本」可导出当前简历页内容，便于我们适配你的平台版本。</div>`;

  panel.querySelector('[data-k="jd"]')?.addEventListener('input', (e) => {
    jdText = (e.target as HTMLTextAreaElement).value;
  });
  panel.querySelector('[data-k="resume"]')?.addEventListener('input', (e) => {
    resumeText = (e.target as HTMLTextAreaElement).value;
  });
  panel.querySelector('[data-act="open-config"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    mode = 'config';
    void render(api, panel);
  });
  panel.querySelector('[data-k="candidate"]')?.addEventListener('change', (e) => {
    sel = Number((e.target as HTMLSelectElement).value);
    resumeText = candidateToText(candidates[sel]!);
    void render(api, panel);
  });
  panel.querySelector('[data-act="extract"]')?.addEventListener('click', async () => {
    const cands = api.extractCandidates?.() ?? [];
    if (cands.length) {
      candidates = cands;
      batchResults = null;
      sel = 0;
      resumeText = candidateToText(cands[0]!);
      feedbackMsg = { kind: 'ok', text: `列表页：提取到 ${cands.length} 位候选人，已选第 1 位。` };
    } else {
      candidates = [];
      batchResults = null;
      const text = api.extractPageText().trim();
      if (!text) {
        feedbackMsg = { kind: 'err', text: '未提取到简历/候选人。可能页面结构已变 — 请手动粘贴，或用「复制页面文本」把内容发给我们适配。' };
      } else {
        resumeText = text;
        feedbackMsg = { kind: 'ok', text: `已提取 ${text.length} 字符。` };
      }
    }
    await render(api, panel);
  });
  panel.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
    feedbackMsg = null;
    await api.copyPageText();
    feedbackMsg = { kind: 'ok', text: '✅ 页面文本已复制。可粘贴到对话里发给我们做平台适配。' };
    await render(api, panel);
  });
  panel.querySelector('[data-act="analyze"]')?.addEventListener('click', async () => {
    if (busy) return;
    const jdRaw = jdText.trim();
    const resumeRaw = resumeText.trim();
    if (!jdRaw && !resumeRaw) {
      feedbackMsg = { kind: 'err', text: '请至少粘贴 JD 或简历其一。' };
      await render(api, panel);
      return;
    }
    if (!resumeRaw) {
      feedbackMsg = { kind: 'err', text: '请提供候选人简历（粘贴、下拉选择或从页面提取）。' };
      await render(api, panel);
      return;
    }
    busy = true;
    result = null;
    feedbackMsg = null;
    await render(api, panel);
    try {
      result = await api.onAnalyze(buildJd(jdRaw), resumeRaw);
      feedbackMsg = { kind: 'ok', text: `完成 · 匹配度 ${result.score}/100（${result.verdict}）` };
    } catch (err) {
      result = null;
      feedbackMsg = { kind: 'err', text: `分析失败：${(err as Error).message}` };
    }
    busy = false;
    await render(api, panel);
  });
  panel.querySelector('[data-act="batch"]')?.addEventListener('click', async () => {
    if (busy || !candidates.length) return;
    const jdRaw = jdText.trim();
    if (!jdRaw) {
      feedbackMsg = { kind: 'err', text: '全部速筛需要先粘贴目标 JD。' };
      await render(api, panel);
      return;
    }
    const jd = buildJd(jdRaw);
    busy = true;
    result = null;
    batchResults = null;
    feedbackMsg = null;
    await render(api, panel);
    const rows: (LiepinCandidate & { result: HrAnalysisResult | null; error?: string })[] = [];
    for (const c of candidates) {
      try {
        rows.push({ ...c, result: await api.onAnalyze(jd, candidateToText(c)) });
      } catch (err) {
        rows.push({ ...c, result: null, error: (err as Error).message });
      }
    }
    batchResults = rows;
    busy = false;
    const invites = rows.filter((r) => r.result?.verdict === '约面').length;
    feedbackMsg = { kind: 'ok', text: `速筛完成：${invites} 位约面 / ${rows.filter((r) => r.result?.verdict === '待定').length} 位待定。` };
    await render(api, panel);
  });
}
