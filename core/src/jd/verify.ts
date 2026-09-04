/**
 * Tailored-resume fact check — the anti-fabrication gate behind
 * POST /v1/resume/verify. Compares the AI-rewritten resume against the base
 * resume and lists every fact in the rewrite absent from the base.
 *
 * Prompt text is a verbatim twin of extension/src/direct/tailor.ts
 * buildVerifyPrompt/verifyTailorFacts — keep in sync.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';

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

/** Pure parse — exported for unit tests. */
export function parseVerifyResponse(text: string): TailorVerification {
  const m = /\[[\s\S]*\]/.exec(text.trim());
  const parsed = JSON.parse(m ? m[0] : text.trim()) as unknown;
  if (!Array.isArray(parsed)) return { fabricated: [], unverified: true };
  const fabricated = [
    ...new Set(parsed.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)),
  ];
  return { fabricated, unverified: false };
}

/**
 * Post-generation fact check. A failed or unparseable verifier call reports
 * `unverified: true` — never silently claim "clean".
 */
export async function verifyTailorFacts(
  provider: ChatProvider,
  resume: string,
  markdown: string,
  log: Logger,
): Promise<TailorVerification> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildVerifyPrompt(resume, markdown) }],
    temperature: 0.1,
  };
  try {
    const result = await provider.chat(req);
    log.debug(`resume verify: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    return parseVerifyResponse(result.text);
  } catch (err) {
    log.warn(`resume verify: failed (${err instanceof Error ? err.message : String(err)}) — unverified`);
    return { fabricated: [], unverified: true };
  }
}
