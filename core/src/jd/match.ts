/**
 * JD match scoring (0-100) with diagnosis: strengths / gaps / risk hints.
 * JSON-mode LLM call validated with zod, one retry. Pure prompt builder is
 * unit-testable; scoring itself goes through the ChatProvider pipeline.
 */
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { extractJson } from './tagger.js';

export interface MatchJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}

export const matchResultSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.string().max(30),
  strengths: z.array(z.string().max(200)).max(8).default([]),
  gaps: z.array(z.string().max(200)).max(8).default([]),
  risks: z.array(z.string().max(200)).max(8).default([]),
});
export type MatchResult = z.infer<typeof matchResultSchema>;

export function buildMatchPrompt(jd: MatchJd, resume?: string): string {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未提供简历：按 JD 通用画像评估，strengths 留空，gaps 写岗位硬性要求）';
  return `你是资深求职顾问。对比岗位 JD 与求职者简历，给出匹配度诊断。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

只输出 JSON（不要任何解释）：
{
  "score": 0-100 的整数,          // 综合匹配度：技能 40% + 年限 25% + 学历 10% + 行业/业务 15% + 工时等硬性条件 10%
  "verdict": "强烈推荐 | 推荐 | 谨慎考虑 | 不匹配",
  "strengths": ["优势项：简历中完全覆盖 JD 的点，每条 ≤30 字"],
  "gaps": ["短板项：缺技能或年限差距，每条 ≤30 字"],
  "risks": ["避坑提示：外包/单休/试用期不交社保/职责不清等风险词信号；没有则空数组"]
}
规则：不编造简历里没有的经历；gaps 只列 JD 明确要求的差距；risks 只列 JD 原文中可推断的信号。`;
}

export function parseMatchResponse(text: string): MatchResult {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const normalized = {
    ...raw,
    score: Math.round(Number(raw.score) || 0),
  };
  return matchResultSchema.parse(normalized);
}

export async function scoreJd(
  provider: ChatProvider,
  jd: MatchJd,
  resume: string | undefined,
  log: Logger,
): Promise<MatchResult> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildMatchPrompt(jd, resume) }],
    temperature: 0.1,
    maxTokens: 1200,
  };
  try {
    const result = await provider.chat(req);
    return parseMatchResponse(result.text);
  } catch (err) {
    log.warn(`match: first attempt failed (${(err as Error).message}), retrying once`);
    const result = await provider.chat(req);
    return parseMatchResponse(result.text);
  }
}
