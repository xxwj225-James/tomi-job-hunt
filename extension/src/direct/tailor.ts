/**
 * Tailored resume — direct-mode port of core/src/jd/tailor.ts. Rewrites the
 * user's resume against a target JD (project reordering, keyword coverage,
 * noise trimming). Same prompt, same JSON-free plain-output contract.
 */
import { directChat } from './llm.js';
import type { JdLike } from '../types.js';

/** Verbatim port of core/src/jd/tailor.ts buildTailorPrompt — keep in sync. */
export function buildTailorPrompt(jd: JdLike, resume: string): string {
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

export async function directTailorResume(jd: JdLike, resume: string): Promise<string> {
  const result = await directChat([{ role: 'user', content: buildTailorPrompt(jd, resume) }]);
  return result.text.trim();
}
