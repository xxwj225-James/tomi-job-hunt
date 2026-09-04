/**
 * HR screening prompt — SYNCHRONIZED COPY of extension/src/direct/prompts.ts
 * `directMatch` (+ its extractJson/parseJson helpers). Keep in sync when the
 * source changes (both sides note this in their headers). Once this project
 * proves out, the prompt should move to a shared package instead of duplicating.
 */
import type { HrChatMessage } from './llm.js';
import { chat } from './llm.js';
import type { HrLlmConfig } from './llm.js';
import { detectIndustry } from './industry.js';

export interface HrMatchResult {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  risks: string[];
}

// --- JSON extraction (same algorithm as extension/src/direct/prompts.ts) ---

export function extractJson(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('No JSON object found in response');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error('Unbalanced JSON in response');
}

function parseJson<T>(text: string): T {
  return JSON.parse(extractJson(text)) as T;
}

// --- Match scoring (SYNC source: extension/src/direct/prompts.ts directMatch) ---

export interface HrJdLike {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}

export async function hrMatch(cfg: HrLlmConfig, jd: HrJdLike, resume: string): Promise<HrMatchResult> {
  const ind = detectIndustry(`${jd.title} ${jd.requirements} ${resume}`);
  const roleLine = ind
    ? `你是${ind}行业资深招聘顾问。对比岗位 JD 与候选人的简历，给出匹配度诊断，用${ind}行业的 HR 视角判断是否邀约面试。\n\n结合${ind}行业的人才供给、薪酬行情与常见风险点评估。`
    : '你是资深招聘顾问。对比岗位 JD 与候选人的简历，给出匹配度诊断，用 HR 视角判断是否邀约面试。';
  const prompt = `${roleLine}

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}

候选人简历：
${resume.slice(0, 4000)}

只输出 JSON（不要任何解释）：
{
  "score": 0-100 的整数,
  "verdict": "强烈推荐 | 推荐 | 谨慎考虑 | 不匹配",
  "strengths": ["匹配优势，每条 ≤30 字，必须引用简历真实内容"],
  "gaps": ["短板，每条 ≤30 字，只列 JD 明确要求的差距；简历未提及≠缺失，可写「简历未体现 xx」并标注"],
  "risks": ["面试风险点（如频繁跳槽、薪资倒挂、简历疑点）；没有则空数组"]
}
规则：
- 评分校准：核心技能与年限匹配即 ≥60 分（即使行业背景不符，行业仅占 15% 权重，不能把总分清零）；完全匹配才给 90+；总分 0 只用于「JD 核心要求与简历完全无关」的情况
- 不编造简历里没有的经历；gaps 只列 JD 明确要求的差距`;
  const messages: HrChatMessage[] = [{ role: 'user', content: prompt }];
  const result = await chat(cfg, messages);
  const raw = parseJson<Record<string, unknown>>(result.text);
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0))),
    verdict: String(raw.verdict ?? '未评分'),
    strengths: Array.isArray(raw.strengths) ? (raw.strengths as string[]) : [],
    gaps: Array.isArray(raw.gaps) ? (raw.gaps as string[]) : [],
    risks: Array.isArray(raw.risks) ? (raw.risks as string[]) : [],
  };
}
