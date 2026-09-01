/**
 * HR online resume analysis — the job-seeker extension's HR counterpart.
 * Match prompt is a SYNCHRONIZED COPY of `hr/src/prompt.ts` `hrMatch` (HR-view
 * perspective), but transported through the extension's `directChatWith(cfg)`
 * so HR uses their own `tomihunt-hr-llm-config` key — NOT the seeker's config.
 * Verdict mapping reuses score.ts (copy of hr/src/screen.ts).
 */
import { directChatWith } from '../direct/llm.js';
import type { DirectLlmConfig } from '../direct/llm.js';
import { extractJson } from '../direct/prompts.js';
import { scoreToHrVerdict } from './score.js';
import type { HrVerdict } from './score.js';

export interface HrJdLike {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}

export interface HrAnalysisResult {
  score: number;
  verdict: HrVerdict;
  strengths: string[];
  gaps: string[];
  risks: string[];
}

/** HR-view match prompt — keep in sync with hr/src/prompt.ts `hrMatch`. */
function buildHrMatchPrompt(jd: HrJdLike, resume: string): string {
  return `你是资深招聘顾问。对比岗位 JD 与候选人的简历，给出匹配度诊断，用 HR 视角判断是否邀约面试。

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
}

export async function analyzeResume(
  cfg: DirectLlmConfig,
  jd: HrJdLike,
  resumeText: string,
): Promise<HrAnalysisResult> {
  const result = await directChatWith(cfg, [
    { role: 'user', content: buildHrMatchPrompt(jd, resumeText) },
  ]);
  const raw = JSON.parse(extractJson(result.text)) as Record<string, unknown>;
  const score = Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0)));
  return {
    score,
    verdict: scoreToHrVerdict(score),
    strengths: Array.isArray(raw.strengths) ? (raw.strengths as string[]) : [],
    gaps: Array.isArray(raw.gaps) ? (raw.gaps as string[]) : [],
    risks: Array.isArray(raw.risks) ? (raw.risks as string[]) : [],
  };
}
