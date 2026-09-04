/**
 * Tailored resume — direct-mode port of core/src/jd/tailor.ts. Rewrites the
 * user's resume against a target JD (project reordering, keyword coverage,
 * noise trimming). Same prompt, same JSON-free plain-output contract.
 *
 * Anti-fabrication: the rewrite prompt forbids inventing facts, and the result
 * is passed through `verifyTailorFacts()` (a second LLM pass) before the UI
 * saves it. Rendering goes to a print-ready HTML page so the user can save the
 * tailored resume as PDF via the browser's print dialog.
 */
import { directChat } from './llm.js';
import type { JdLike } from '../types.js';
import { detectIndustry } from './industry.js';

/** Verbatim port of core/src/jd/tailor.ts buildTailorPrompt — keep in sync. */
export function buildTailorPrompt(jd: JdLike, resume: string): string {
  const ind = detectIndustry(`${jd.title} ${jd.requirements} ${resume}`);
  const roleLine = ind
    ? `你是${ind}行业简历定制专家。根据目标 JD 改写求职者的 Markdown 简历。\n\n按${ind}行业的关键词与人才需求侧重点组织内容。`
    : '你是简历定制专家。根据目标 JD 改写求职者的 Markdown 简历。';
  return `${roleLine}

目标岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000)}

求职者当前简历：
${resume.slice(0, 6000)}

改写要求：
1. 输出完整 Markdown 简历（含所有章节：求职意向/技能栈/工作经历/项目经历/教育）
2. 项目按与 JD 的相关度重排序；与 JD 无关的经历压缩或删除
3. 强化 JD 关键词覆盖：JD 提到的技术/业务词，简历里有对应经历的用原词写出；没有的绝不编造
4. 每段经历保持"动词 + 动作 + 量化结果"结构
5. 求职意向/期望薪资按原简历保留，不改写
6. 所有事实——公司名、职位、项目/产品名、技术栈、证书、学历、入职/离职时间、工作年限、量化数字（KPI、人数、金额、性能指标）——一律以原简历为准，原样保留，不得改动、不得新增
7. 原简历里没有的经历、成果、证书、数字，一律不写，绝不为了匹配 JD 而编造或臆测
8. 只输出 Markdown 简历本身，不要任何解释、标题或引号`;
}

export async function directTailorResume(jd: JdLike, resume: string): Promise<string> {
  const result = await directChat([{ role: 'user', content: buildTailorPrompt(jd, resume) }]);
  return result.text.trim();
}

/** Result of the post-generation fact check. */
export interface TailorVerification {
  /** Facts found in the tailored markdown that are absent from the base resume. */
  fabricated: string[];
  /** True when the verifier LLM call failed or returned unparseable output. */
  unverified: boolean;
}

/** Verifier prompt — tells the model to diff the tailored output against the base resume. */
export function buildVerifyPrompt(resume: string, markdown: string): string {
  return `你是简历事实核查员，负责检查 AI 改写后的简历有没有编造事实。下面提供求职者的【原简历】和按 JD 改写后的【定制版】。

【原简历】
${resume.slice(0, 6000)}

【定制版】
${markdown.slice(0, 6000)}

任务：找出「定制版」中所有【原简历里完全不存在】的事实，包括但不限于：公司名称、岗位/职位、项目/产品名称、技术栈/技能、证书/奖项、学历、入职/离职时间、工作年限、量化数字（KPI、人数、金额、性能指标、并发量）。只改写措辞、调整顺序、浓缩细节不算编造；只有原简历没有对应事实、被凭空新增的才算编造。

只输出一个 JSON 数组，每一项是一条被编造的事实（含该处原文片段，10-30字）。没有编造就输出 []。除此之外不要输出任何解释。`;
}

/**
 * Post-LLM fact check: asks the model to list facts in the tailored markdown
 * that don't exist in the base resume. Returns the fabricated list; a failed
 * or unparseable verifier call is reported as `unverified: true` (the caller
 * decides whether to block — never silently claim "clean").
 */
export async function verifyTailorFacts(resume: string, markdown: string): Promise<TailorVerification> {
  try {
    const result = await directChat([{ role: 'user', content: buildVerifyPrompt(resume, markdown) }]);
    const m = /\[[\s\S]*\]/.exec(result.text.trim());
    const parsed = JSON.parse(m ? m[0] : result.text.trim()) as unknown;
    if (!Array.isArray(parsed)) return { fabricated: [], unverified: true };
    const fabricated = [...new Set(
      parsed.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean),
    )];
    return { fabricated, unverified: false };
  } catch {
    return { fabricated: [], unverified: true };
  }
}

/**
 * Markdown → print-ready HTML resume page (headings / lists / bold / code).
 * The page carries a "保存为 PDF" toolbar (hidden when printed) so the user
 * saves the tailored resume via the browser print dialog. Verbatim-rendering
 * logic shared with core/src/jd/tailor.ts mdToHtml — keep the line walk in sync.
 */
export function mdToHtml(md: string, title = '定制简历'): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h3 = /^###\s+(.*)/.exec(line);
    const li = /^[-*]\s+(.*)/.exec(line);
    if (h1) {
      closeList();
      out.push(`<h1>${inline(h1[1]!)}</h1>`);
    } else if (h2) {
      closeList();
      out.push(`<h2>${inline(h2[1]!)}</h2>`);
    } else if (h3) {
      closeList();
      out.push(`<h3>${inline(h3[1]!)}</h3>`);
    } else if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(li[1]!)}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, 'Microsoft YaHei', 'PingFang SC', sans-serif; color: #222; max-width: 760px; margin: 0 auto; padding: 28px 24px 60px; line-height: 1.7; }
  h1 { font-size: 26px; margin: 0 0 6px; }
  h2 { font-size: 17px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e3e9f7; color: #1f2a44; }
  h3 { font-size: 15px; margin: 14px 0 4px; }
  p { margin: 6px 0; }
  ul { margin: 6px 0; padding-left: 22px; }
  li { margin: 3px 0; }
  strong { color: #1f2a44; }
  code { background: #f0f2f7; border-radius: 4px; padding: 1px 5px; font-size: 13px; }
  .toolbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #eef0f4; padding: 10px 0; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
  .toolbar button { background: linear-gradient(135deg, #4f7cff, #6a5cff); color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .toolbar .hint { color: #888; font-size: 12px; }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; max-width: none; }
    h1, h2, h3 { break-after: avoid; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">🖨 保存为 PDF</button><span class="hint">点击后在打印窗口选择「另存为 PDF」</span></div>
${out.join('\n')}
</body>
</html>`;
}

/** Escaped + inline Markdown (**bold**, `code`) — safe for HTML insertion. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
