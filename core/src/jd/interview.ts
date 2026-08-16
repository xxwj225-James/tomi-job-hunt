/**
 * Interview prep — predicts 5-10 likely interview questions for a target JD
 * (technical + behavioral, STAR answer hints). JSON-mode LLM, zod validated.
 */
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { extractJson } from './tagger.js';
import type { MatchJd } from './match.js';

export const interviewResultSchema = z.object({
  questions: z
    .array(
      z.object({
        q: z.string().min(1).max(200),
        intent: z.string().max(60), // what the interviewer is probing
        starHint: z.string().max(300), // STAR 法则回答建议
      }),
    )
    .min(3)
    .max(10),
});
export type InterviewResult = z.infer<typeof interviewResultSchema>;

export function buildInterviewPrompt(jd: MatchJd, resume?: string): string {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未提供简历：题目按 JD 通用画像出）';
  return `你是资深面试官。针对目标岗位预测 5~10 道最可能被问到的面试题。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

出题要求：
1. 技术题 60%：直接来自 JD 技术栈的深挖题（如"Redis 缓存穿透怎么处理？"），结合简历项目经历追问
2. 行为题 40%：STAR 法则场景题（项目冲突、延期、跨部门协作）
3. 只输出 JSON：
{
  "questions": [
    {"q": "题目", "intent": "面试官在考察什么（≤15字）", "starHint": "STAR 法则回答要点（≤80字）"}
  ]
}
不要输出任何解释。`;
}

export function parseInterviewResponse(text: string): InterviewResult {
  const raw = JSON.parse(extractJson(text)) as unknown;
  return interviewResultSchema.parse(raw);
}

export async function interviewPrep(
  provider: ChatProvider,
  jd: MatchJd,
  resume: string | undefined,
  log: Logger,
): Promise<InterviewResult> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildInterviewPrompt(jd, resume) }],
    temperature: 0.4,
    maxTokens: 2000,
  };
  try {
    const result = await provider.chat(req);
    return parseInterviewResponse(result.text);
  } catch (err) {
    log.warn(`interview: first attempt failed (${(err as Error).message}), retrying once`);
    const result = await provider.chat(req);
    return parseInterviewResponse(result.text);
  }
}
