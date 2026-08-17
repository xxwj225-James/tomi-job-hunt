/**
 * Greeting pitch engine — "100-character high-response-rate greeting" for
 * Boss直聘. Combines the JD's hard requirements with the user's resume
 * (loaded via resume-files.ts from the config dir; optional). Reuses the
 * ChatProvider pipeline.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';

const MAX_PITCH_LENGTH = 120;

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
export function buildGreetingPrompt(jd: GreetingJd, resume?: string): string {
  const resumePart = resume
    ? `\n\n求职者简历（Markdown 节选）：\n${resume.slice(0, 4000)}`
    : '\n\n（求职者未配置简历，仅基于 JD 生成，用通用匹配话术）';
  return `你是求职者的招聘沟通助手。请为以下岗位生成一条 Boss 直聘「打招呼语」。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求：
${jd.requirements.slice(0, 4000) || '未提供'}${resumePart}

要求：
1. 长度 80~120 字，中文，口语化，像真人打招呼，不要书面腔
2. 直击 JD 的核心硬性要求，用简历中真实匹配的经历做证据（如「做过 xx 亿级订单系统」「主导过 xx」）；没有简历时突出通用的核心匹配点
3. 不提学历短板等减分项；不吹捧公司
4. 结尾抛出具体问题或行动（如「方便看下我的简历吗？」）
5. 只输出打招呼语本身，不要任何解释、标题或引号`;
}

export async function greetJd(
  provider: ChatProvider,
  jd: GreetingJd,
  resume: string | undefined,
  log: Logger,
): Promise<GreetingResult> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildGreetingPrompt(jd, resume) }],
    temperature: 0.7,
    maxTokens: 512,
  };
  const result = await provider.chat(req);
  log.debug(`greeting: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  const pitch = result.text.trim().slice(0, MAX_PITCH_LENGTH);
  return {
    pitch,
    warning: resume ? undefined : '未配置简历（~/.tomi-job-hunt/resume.md / resume.docx / resume.pdf），已按 JD 通用生成',
  };
}
