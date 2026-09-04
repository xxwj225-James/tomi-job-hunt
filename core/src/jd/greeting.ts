/**
 * Greeting pitch engine — "100-character high-response-rate greeting" for
 * Boss直聘. Combines the JD's hard requirements with the user's resume
 * (loaded via resume-files.ts from the config dir; optional). Reuses the
 * ChatProvider pipeline.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { detectIndustry } from './industry.js';
import { extractJson } from './tagger.js';

const MAX_PITCH_LENGTH = 120;

/** Trim, strip one pair of wrapping quotes, then truncate at a punctuation
 *  boundary so a pitch never ends mid-sentence. Models occasionally run a few
 *  characters long (or wrap the pitch in quotes) — a blind slice(0, 120) then
 *  cuts inside a word and the greeting reads broken. */
export function normalizePitch(text: string, max: number = MAX_PITCH_LENGTH): string {
  let t = text.trim();
  const wrapped = t.match(/^([「『“"''])([\s\S]*?)([」』”"'])$/);
  if (wrapped?.[2]) t = wrapped[2].trim();
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

/** A JD-oriented matching point: one real resume fact, reframed toward the JD. */
export interface GreetingPoint {
  /** A JD keyword (from techStack / requirements) the resume genuinely covers. */
  keyword: string;
  /** One-line, ≤40 chars — the resume fact restated in the JD's domain framing. */
  reframed: string;
}

export interface GreetingResult {
  pitch: string;
  /** Set when no resume was configured — pitch was generated JD-only. */
  warning?: string;
  /** Stage-1 JD-oriented matching points the pitch was built from (for display). */
  points?: GreetingPoint[];
}

/** Pure prompt builder — unit-testable. */
export function buildGreetingPrompt(jd: GreetingJd, resume?: string, feedback?: string): string {
  const ind = detectIndustry(`${jd.title} ${jd.requirements} ${resume ?? ''}`);
  const resumePart = resume
    ? `\n\n求职者简历（Markdown，以下内容是唯一可信的事实来源）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未配置简历——打招呼语中不得声称拥有任何具体技能、年限或经历，只能用通用真实的表达）';
  const feedbackPart = feedback
    ? `\n\n用户对上一版打招呼语的修改意见（必须严格遵循）：\n${feedback.slice(0, 500)}`
    : '';
  const roleLine = ind
    ? `你是深耕${ind}行业的资深猎头专家。请为以下岗位生成一条 Boss 直聘「打招呼语」。\n\n结合${ind}行业的人才需求特点与 HR 关注点，突出求职者与岗位最相关的亮点。`
    : '你是求职者的招聘沟通助手。请为以下岗位生成一条 Boss 直聘「打招呼语」。';
  return `${roleLine}

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

/** Stage-1 prompt: extract JD-oriented matching points from the resume (reframing
 *  resume facts toward the JD's domain). Verbatim twin of
 *  extension/src/direct/prompts.ts buildGreetingPointsPrompt — keep in sync. */
export function buildGreetingPointsPrompt(
  jd: GreetingJd,
  resume: string,
  tags?: { techStack?: string[]; summary?: string } | null,
): string {
  const stack = tags?.techStack?.length ? tags.techStack.join('、') : '（无）';
  return `你是简历定向改写专家。根据目标 JD 的任职要求与关键词，从求职者简历里提炼「JD 定向匹配点」：把与 JD 相关的真实经历，按 JD 的领域口径改写为一句话。

岗位：${jd.title}
公司：${jd.company}
任职要求：
${jd.requirements.slice(0, 3000) || '未提供'}

JD 关键词（techStack）：${stack}
JD 摘要：${tags?.summary || '（无）'}

求职者简历（Markdown，以下内容是唯一可信的事实来源）：
${resume.slice(0, 6000)}

改写要求：
1. 只从简历真实内容里提炼匹配点；每项 = 一个 JD 关键词（keyword，用上面 techStack 或任职要求里的原词，小写英文）+ 一句话描述（reframed，≤40 字，描述该真实经历按 JD 口径的呈现方式）
2. 关键词优先从 JD 的 techStack 里挑，其次任职要求；只挑简历里真实覆盖的 2~4 个，没覆盖的不硬凑
3. 领域定向改写：复合型/软硬结合的经历按 JD 领域侧重重述（例如软硬结合项目投 IT 信息岗，突出数据、系统、接口、信息化改造等 IT 侧，弱化硬件/设备侧）；只能把简历里真实存在的部分换口径重述
4. 【绝对禁止编造】公司/职位/项目名/技术栈/证书/学历/年限/量化数字一律以简历为准、原样保留；不得为贴近 JD 新增任何经历、技术或数字
5. 只输出 JSON 对象，格式：{"points": [{"keyword": "sql", "reframed": "负责软硬件联调与数据信息管理，主导系统集成"}]}
6. 简历里没有可匹配的真实经历就输出 {"points": []}
7. 不要输出任何解释、标题或 markdown 代码块`;
}

/** Parse the Stage-1 points JSON; malformed output → [] (caller falls back to single-pass). */
export function parseGreetingPoints(text: string): GreetingPoint[] {
  try {
    const raw = JSON.parse(extractJson(text)) as { points?: unknown };
    if (!Array.isArray(raw.points)) return [];
    const points: GreetingPoint[] = [];
    for (const item of raw.points) {
      if (typeof item !== 'object' || item === null) continue;
      const rec = item as Record<string, unknown>;
      const keyword = String(rec.keyword ?? '').trim();
      const reframed = String(rec.reframed ?? '').trim();
      if (!keyword || !reframed) continue;
      points.push({ keyword: keyword.slice(0, 30), reframed: reframed.slice(0, 40) });
    }
    return points.slice(0, 4);
  } catch {
    return [];
  }
}

/** Stage-2 prompt when Stage-1 matching points exist — JD identity + points only,
 *  no raw resume (the model can't re-anchor on an unrelated bullet).
 *  Verbatim twin of extension buildGreetingFromPointsPrompt — keep in sync. */
export function buildGreetingFromPointsPrompt(
  jd: GreetingJd,
  points: GreetingPoint[],
  feedback?: string,
  resume?: string,
): string {
  const ind = detectIndustry(`${jd.title} ${jd.requirements} ${resume ?? ''}`);
  const feedbackPart = feedback
    ? `\n\n用户对上一版打招呼语的修改意见（必须严格遵循）：\n${feedback.slice(0, 500)}`
    : '';
  const roleLine = ind
    ? `你是深耕${ind}行业的资深猎头专家。请为以下岗位生成一条 Boss 直聘「打招呼语」。\n\n结合${ind}行业的人才需求特点与 HR 关注点，突出求职者与岗位最相关的亮点。`
    : '你是求职者的招聘沟通助手。请为以下岗位生成一条 Boss 直聘「打招呼语」。';
  const pointsPart = points
    .slice(0, 4)
    .map((p, i) => `${i + 1}. ${p.keyword}：${p.reframed}`)
    .join('\n');
  return `${roleLine}

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}

【已按 JD 定向提炼的匹配点】（基于求职者简历真实经历改写，以下内容是唯一可信的事实来源）：
${pointsPart}

要求：
1. 长度 80~120 字，中文，口语化，像真人打招呼，不要书面腔
2. 从上面的匹配点里挑 1~2 条展开；每条严格按给出的改写口径复述，不得添加匹配点里没有的经历、技能或数字
3. 【绝对禁止编造】匹配点里没有的内容（技能、年限、项目、公司、具体数字）一律不得虚构。
   JD 的硬性要求而匹配点里没有的：坦诚表达「有相关基础 / 正在积累」，宁可少说不虚构
4. 不提学历短板等减分项；不吹捧公司
5. 结尾抛出具体问题或行动
6. 只输出打招呼语本身，不要任何解释、标题或引号${feedbackPart}`;
}

/** Stage 1 — extract JD-oriented matching points. Deterministic JSON parse; failures → [].
 *  temperature 0.3 keeps the JSON stable (see interview.ts). */
export async function greetPoints(
  provider: ChatProvider,
  jd: GreetingJd,
  resume: string,
  tags: { techStack?: string[]; summary?: string } | null | undefined,
  log: Logger,
): Promise<GreetingPoint[]> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildGreetingPointsPrompt(jd, resume, tags) }],
    temperature: 0.3,
  };
  try {
    const result = await provider.chat(req);
    log.debug(`greeting points: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    return parseGreetingPoints(result.text);
  } catch (err) {
    log.warn(`greeting points: first attempt failed (${(err as Error).message}), retrying once`);
    const result = await provider.chat(req);
    return parseGreetingPoints(result.text);
  }
}

export async function greetJd(
  provider: ChatProvider,
  jd: GreetingJd,
  resume: string | undefined,
  log: Logger,
  feedback?: string,
  tags?: { techStack?: string[]; summary?: string } | null,
): Promise<GreetingResult> {
  // Two-stage: Stage 1 reframes resume facts toward the JD's domain into
  // matching points; Stage 2 builds the pitch from those points only. Empty
  // points → classic single-pass fallback (zero regression).
  let points: GreetingPoint[] = [];
  if (resume) {
    try {
      points = await greetPoints(provider, jd, resume, tags, log);
    } catch (err) {
      log.warn(`greeting: point extraction failed (${(err as Error).message}), falling back to single-pass`);
    }
  }
  const pitch = points.length > 0
    ? await pitchFromPoints(provider, jd, points, resume, feedback, log)
    : await pitchSinglePass(provider, jd, resume, feedback, log);
  return {
    pitch,
    warning: resume ? undefined : '未配置简历（~/.tomi-job-hunt/resume.md / resume.docx / resume.pdf），已按 JD 通用生成',
    ...(points.length > 0 ? { points } : {}),
  };
}

async function pitchSinglePass(
  provider: ChatProvider,
  jd: GreetingJd,
  resume: string | undefined,
  feedback: string | undefined,
  log: Logger,
): Promise<string> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildGreetingPrompt(jd, resume, feedback) }],
    temperature: 0.7,
  };
  const result = await provider.chat(req);
  log.debug(`greeting: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  return scrubUnsupportedYears(normalizePitch(result.text), resume);
}

async function pitchFromPoints(
  provider: ChatProvider,
  jd: GreetingJd,
  points: GreetingPoint[],
  resume: string | undefined,
  feedback: string | undefined,
  log: Logger,
): Promise<string> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildGreetingFromPointsPrompt(jd, points, feedback, resume) }],
    temperature: 0.7,
  };
  const result = await provider.chat(req);
  log.debug(`greeting(from points): ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  return scrubUnsupportedYears(normalizePitch(result.text), resume);
}
