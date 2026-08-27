/**
 * Tailored resume — rewrites the user's resume.md against a target JD:
 * reorders projects, strengthens keyword coverage, trims irrelevant noise.
 *
 * Export: Markdown (universal) and .doc (HTML Word opens natively) — zero
 * dependencies, no server-side PDF pipeline needed for a local tool.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import type { MatchJd } from './match.js';

export function buildTailorPrompt(jd: MatchJd, resume: string): string {
  return `你是简历定制专家。根据目标 JD 改写求职者的 Markdown 简历。

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
6. 只输出 Markdown 简历本身，不要任何解释、标题或引号`;
}

export async function tailorResume(
  provider: ChatProvider,
  jd: MatchJd,
  resume: string,
  log: Logger,
): Promise<string> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildTailorPrompt(jd, resume) }],
    temperature: 0.3,
  };
  const result = await provider.chat(req);
  log.debug(`tailor: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  return result.text.trim();
}

/** Minimal Markdown → Word-friendly HTML (headings, paragraphs, lists). */
export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const h3 = /^###\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    const h1 = /^#\s+(.*)/.exec(line);
    const li = /^[-*]\s+(.*)/.exec(line);
    if (h1) {
      closeList();
      out.push(`<h1>${escapeHtml(h1[1]!)}</h1>`);
    } else if (h2) {
      closeList();
      out.push(`<h2>${escapeHtml(h2[1]!)}</h2>`);
    } else if (h3) {
      closeList();
      out.push(`<h3>${escapeHtml(h3[1]!)}</h3>`);
    } else if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${escapeHtml(li[1]!)}</li>`);
    } else if (line.trim() === '') {
      closeList();
    } else {
      out.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  closeList();

  function closeList(): void {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>简历</title></head><body>${out.join('\n')}</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
