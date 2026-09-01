/**
 * Prompt builders + JSON parsers for direct mode — ported from core
 * (core/src/jd/{tagger,greeting,match,interview}.ts) so the extension works
 * without the local Core service. Kept intentionally simple: same prompts,
 * same zod-free validation (manual shape checks).
 */
import type { JdTags, ReplyResult, ReplyTurn } from '../types.js';
import { directChat } from './llm.js';

// --- JSON extraction (same algorithm as core/src/jd/tagger.ts) ---

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

// --- Tagging (port of core tagger) ---

const TAG_PROMPT = `你是招聘信息结构化分析助手。只输出 JSON，不要输出任何解释或 markdown 代码块。

请分析以下招聘信息，提取结构化标签。

{jd}

输出 JSON，格式如下：
{
  "techStack": ["string"],
  "yearsReq": "应届 | 1-3 | 3-5 | 5-10 | 10+ | 不限",
  "degreeReq": "不限 | 大专 | 本科 | 硕士 | 博士",
  "workHours": "双休 | 大小周 | 单休 | 弹性 | 未标注",
  "salaryBandK": [min, max],
  "riskFlags": ["string"],
  "remote": true/false,
  "summary": "不超过50字的客观岗位摘要"
}
注意：不推测原文没有的信息；workHours 未提及就填"未标注"；summary 用客观陈述。`;

export async function directTagJd(jd: { title: string; company: string; salaryText: string; requirements: string }): Promise<JdTags> {
  const content = `岗位：${jd.title}\n公司：${jd.company}\n薪资：${jd.salaryText || '未标注'}\n任职要求原文：\n${jd.requirements || '未提供'}`;
  const result = await directChat([
    { role: 'system', content: '你是招聘信息结构化分析助手。只输出 JSON。' },
    { role: 'user', content: TAG_PROMPT.replace('{jd}', content) },
  ]);
  const raw = parseJson<Record<string, unknown>>(result.text);
  const tags = raw as Partial<JdTags>;
  return {
    techStack: Array.isArray(tags.techStack) ? (tags.techStack as string[]).map((t) => t.trim()) : [],
    yearsReq: typeof tags.yearsReq === 'string' ? (tags.yearsReq as JdTags['yearsReq']) : undefined,
    degreeReq: typeof tags.degreeReq === 'string' ? (tags.degreeReq as JdTags['degreeReq']) : undefined,
    workHours: typeof tags.workHours === 'string' ? (tags.workHours as JdTags['workHours']) : '未标注',
    salaryBandK: Array.isArray(tags.salaryBandK) && tags.salaryBandK.length === 2
      ? [Number(tags.salaryBandK[0]), Number(tags.salaryBandK[1])]
      : undefined,
    riskFlags: Array.isArray(tags.riskFlags) ? (tags.riskFlags as string[]) : [],
    remote: typeof tags.remote === 'boolean' ? tags.remote : undefined,
    summary: String(tags.summary ?? '').slice(0, 50),
  };
}

// --- Greeting (port of core greeting.ts) ---

export async function directGreeting(jd: {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}, resume?: string, feedback?: string): Promise<{ pitch: string; warning?: string }> {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown，以下内容是唯一可信的事实来源）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未配置简历——打招呼语中不得声称拥有任何具体技能、年限或经历，只能用通用真实的表达）';
  const feedbackPart = feedback
    ? `\n\n用户对上一版打招呼语的修改意见（必须严格遵循）：\n${feedback.slice(0, 500)}`
    : '';
  const prompt = `你是求职者的招聘沟通助手。请为以下岗位生成一条 Boss 直聘「打招呼语」。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

要求：
1. 长度 80~120 字，中文，口语化，像真人打招呼，不要书面腔
2. 只引用简历中真实存在的经历、技能、年限、项目、数据来匹配 JD，挑简历里真实相关的点展开
3. 【绝对禁止编造】不得虚构简历中不存在的任何内容（技能、年限、项目、公司、具体数字都不行）。
   JD 的硬性要求而简历里没有的：换成简历里真实相关的经历来体现匹配，或坦诚表达「有相关基础 / 正在积累」，
   宁可少说不虚构；不要为了贴近 JD 而添加简历里没有的经历
4. 简历为空时（上方已注明），不得假装拥有任何技能或经历，只用通用真实的表达（对岗位感兴趣、希望进一步沟通），绝不编造技能清单
5. 不提学历短板等减分项；不吹捧公司
6. 结尾抛出具体问题或行动
7. 只输出打招呼语本身，不要任何解释、标题或引号${feedbackPart}`;
  const result = await directChat([{ role: 'user', content: prompt }]);
  return {
    pitch: scrubUnsupportedYears(normalizePitch(result.text), resume),
    warning: resume ? undefined : '未配置简历，已按 JD 通用生成（点插件图标 → 设置 → 粘贴简历，话术会更有针对性）',
  };
}

/**
 * Deterministic anti-fabrication net (numbers are the most visible fakes):
 * a "X年…" claim whose X does not appear in the resume is almost certainly
 * hallucinated to match the JD — drop the year, keep the skill
 * ("5年Java开发经验" → "Java开发经验"). No-op when the year IS in the
 * resume, or when no resume was provided (the prompt already forbids claims).
 */
export function scrubUnsupportedYears(pitch: string, resume?: string): string {
  if (!resume) return pitch;
  const resumeText = ` ${resume.replace(/\s+/g, ' ')} `;
  const years = new Set<string>();
  const matcher = /(\d{1,2})\s*年(?:以上)?/g;
  let m: RegExpExecArray | null;
  while ((m = matcher.exec(pitch)) !== null) years.add(m[1]!);
  let out = pitch;
  for (const n of years) {
    if (new RegExp(`(^|[^0-9])${n}年`, 'i').test(resumeText)) continue;
    out = out.replace(new RegExp(`${n}\\s*年(?:以上)?`, 'g'), '');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Trim, strip one pair of wrapping quotes, then truncate at a punctuation
 *  boundary so a pitch never ends mid-sentence. Mirror of core/src/jd/greeting.ts. */
function normalizePitch(text: string, max: number = 120): string {
  let t = text.trim();
  const wrapped = t.match(/^([「『“"''])([\s\S]*?)([」』”"'])$/);
  if (wrapped) t = wrapped[2].trim();
  if (t.length <= max) return t;

  const cut = t.slice(0, max);
  let at = -1;
  for (const ch of ['。', '！', '？', '!', '?', '…', '，', ',']) {
    const i = cut.lastIndexOf(ch);
    if (i > at) at = i;
  }
  return at >= 0 ? t.slice(0, at + 1) : cut;
}

// --- Match scoring (port of core match.ts) ---

export interface DirectMatchResult {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  risks: string[];
}

export async function directMatch(jd: {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}, resume?: string): Promise<DirectMatchResult> {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未提供简历：按 JD 通用画像评估，strengths 留空，gaps 写岗位硬性要求）';
  const prompt = `你是资深求职顾问。对比岗位 JD 与求职者简历，给出匹配度诊断。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

只输出 JSON（不要任何解释）：
{
  "score": 0-100 的整数,
  "verdict": "强烈推荐 | 推荐 | 谨慎考虑 | 不匹配",
  "strengths": ["优势项，每条 ≤30 字"],
  "gaps": ["短板项，每条 ≤30 字"],
  "risks": ["避坑提示；没有则空数组"]
}
规则：
- 评分校准：核心技能与年限匹配即 ≥60 分（即使行业背景不符，行业仅占 15% 权重，不能把总分清零）；完全匹配才给 90+；总分 0 只用于「JD 核心要求与简历完全无关」的情况
- strengths 必须引用简历中真实存在的经历；gaps 只列简历中明确缺失或明显不足的项——简历中未提及不等于缺失，可写「简历未体现 xx」但必须单独标注
- 不编造简历里没有的经历；gaps 只列 JD 明确要求的差距`;
  const result = await directChat([{ role: 'user', content: prompt }]);
  const raw = parseJson<Record<string, unknown>>(result.text);
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0))),
    verdict: String(raw.verdict ?? '未评分'),
    strengths: Array.isArray(raw.strengths) ? (raw.strengths as string[]) : [],
    gaps: Array.isArray(raw.gaps) ? (raw.gaps as string[]) : [],
    risks: Array.isArray(raw.risks) ? (raw.risks as string[]) : [],
  };
}

// --- Smart reply (port of core reply.ts) ---

export async function directReply(
  jd: { title: string; company: string; salaryText: string; requirements: string },
  resume: string | undefined,
  history: ReplyTurn[],
  incoming: string,
): Promise<ReplyResult> {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown 节选）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未提供简历，按通用求职者身份回复）';
  const historyPart =
    history.length > 0
      ? `\n\n最近对话（时间顺序）：\n${history
          .slice(-8)
          .map((t) => `${t.speaker === 'hr' ? '[对方]' : '[我]'} ${t.content.slice(0, 300)}`)
          .join('\n')}`
      : '\n\n（这是第一次对话）';
  const prompt = `你是正在求职的候选人。对方（HR/猎头）刚发来一条消息，请帮「我」拟一条回复。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 3000) || '未提供'}${resumePart}${historyPart}

对方最新消息：
${incoming.slice(0, 1000)}

要求：
1. 20~80 字，中文，口语化、专业
2. 基于简历中的真实经历回答对方的问题；不确定的信息不编造
3. 顺着推进对话：回答对方问题、表达意向，或提出下一步
4. 只输出回复内容本身，不要引号、不要任何解释`;
  const result = await directChat([{ role: 'user', content: prompt }]);
  return { reply: result.text.trim().slice(0, 200) };
}

// --- Interview prep (port of core interview.ts) ---

export interface DirectInterviewQuestion {
  q: string;
  intent: string;
  starHint: string;
}

export async function directInterviewPrep(jd: {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}, resume?: string): Promise<{ questions: DirectInterviewQuestion[] }> {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未提供简历：题目按 JD 通用画像出）';
  const prompt = `你是资深面试官。针对目标岗位预测 5~10 道最可能被问到的面试题。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

出题要求：
1. 技术题 60%：直接来自 JD 技术栈的深挖题；行为题 40%：STAR 法则场景题
2. 只输出 JSON：
{
  "questions": [
    {"q": "题目", "intent": "面试官在考察什么（≤15字）", "starHint": "STAR 法则回答要点（≤80字）"}
  ]
}
不要输出任何解释。`;
  const result = await directChat([{ role: 'user', content: prompt }]);
  const raw = parseJson<{ questions?: Array<Record<string, unknown>> }>(result.text);
  const questions = (raw.questions ?? []).slice(0, 10).map((q) => ({
    q: String(q.q ?? ''),
    intent: String(q.intent ?? ''),
    starHint: String(q.starHint ?? ''),
  }));
  if (questions.length < 3 || questions.some((q) => !q.q)) {
    throw new Error('面试题生成结果不完整，请重试');
  }
  return { questions };
}
