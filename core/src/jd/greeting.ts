/**
 * Greeting pitch engine — "100-character high-response-rate greeting" for
 * Boss直聘. Combines the JD's hard requirements with the user's resume
 * (loaded via resume-files.ts from the config dir; optional). Reuses the
 * ChatProvider pipeline.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';

const MAX_PITCH_LENGTH = 120;

/** Trim, strip one pair of wrapping quotes, then truncate at a punctuation
 *  boundary so a pitch never ends mid-sentence. Models occasionally run a few
 *  characters long (or wrap the pitch in quotes) — a blind slice(0, 120) then
 *  cuts inside a word and the greeting reads broken. */
export function normalizePitch(text: string, max: number = MAX_PITCH_LENGTH): string {
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

export interface GreetingJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}

export interface GreetingResult {
  pitch: string;
  /** Set when no resume was configured — pitch was generated JD-only. */
  warning?: string;
}

/** Pure prompt builder — unit-testable. */
export function buildGreetingPrompt(jd: GreetingJd, resume?: string, feedback?: string): string {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown，以下内容是唯一可信的事实来源）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未配置简历——打招呼语中不得声称拥有任何具体技能、年限或经历，只能用通用真实的表达）';
  const feedbackPart = feedback
    ? `\n\n用户对上一版打招呼语的修改意见（必须严格遵循）：\n${feedback.slice(0, 500)}`
    : '';
  return `你是求职者的招聘沟通助手。请为以下岗位生成一条 Boss 直聘「打招呼语」。

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
6. 结尾抛出具体问题或行动（如「方便看下我的简历吗？」）
7. 只输出打招呼语本身，不要任何解释、标题或引号${feedbackPart}`;
}

/**
 * Deterministic anti-fabrication net (mirror of the extension's
 * scrubUnsupportedYears): a "X年…" claim whose X does not appear in the resume
 * is almost certainly hallucinated to match the JD — drop the year, keep the
 * skill ("5年Java开发经验" → "Java开发经验"). No-op when the year IS in the
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

export async function greetJd(
  provider: ChatProvider,
  jd: GreetingJd,
  resume: string | undefined,
  log: Logger,
  feedback?: string,
): Promise<GreetingResult> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildGreetingPrompt(jd, resume, feedback) }],
    temperature: 0.7,
  };
  const result = await provider.chat(req);
  log.debug(`greeting: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  const pitch = scrubUnsupportedYears(normalizePitch(result.text), resume);
  return {
    pitch,
    warning: resume ? undefined : '未配置简历（~/.tomi-job-hunt/resume.md / resume.docx / resume.pdf），已按 JD 通用生成',
  };
}
