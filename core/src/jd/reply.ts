/**
 * Smart reply engine — when an HR/recruiter sends a message, draft a reply
 * grounded in the JD + resume + recent conversation. The reply is FILLED
 * into the chat box only; the user always clicks send themselves.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import type { MatchJd } from './match.js';
import { detectIndustry } from './industry.js';

export interface ReplyTurn {
  /** 'hr' = the other side, 'me' = the user. */
  speaker: 'hr' | 'me';
  content: string;
}

export interface ReplyResult {
  reply: string;
}

export function buildReplyPrompt(
  jd: MatchJd,
  resume: string | undefined,
  history: ReplyTurn[],
  incoming: string,
): string {
  const ind = detectIndustry(`${jd.title} ${jd.requirements} ${resume ?? ''}`);
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
  const roleLine = ind
    ? `你是正在求职的${ind}行业候选人。对方（HR/猎头）刚发来一条消息，请帮「我」拟一条回复。\n\n按${ind}行业的职场表达习惯回复，体现专业与行业常识。`
    : '你是正在求职的候选人。对方（HR/猎头）刚发来一条消息，请帮「我」拟一条回复。';
  return `${roleLine}

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
3. 顺着推进对话：回答对方问题、表达意向，或提出下一步（如「方便约个时间详聊吗？」）
4. 只输出回复内容本身，不要引号、不要任何解释`;
}

export async function replyToHr(
  provider: ChatProvider,
  jd: MatchJd,
  resume: string | undefined,
  history: ReplyTurn[],
  incoming: string,
  log: Logger,
): Promise<ReplyResult> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildReplyPrompt(jd, resume, history, incoming) }],
    temperature: 0.5,
  };
  const result = await provider.chat(req);
  log.debug(`reply: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  return { reply: result.text.trim().slice(0, 200) };
}
