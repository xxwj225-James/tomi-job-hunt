/**
 * Reverse job hunting (维度四 / roadmap Phase 6) — 从「人找岗」到「岗找人」.
 *
 * Two LLM-driven steps:
 *   1. Target company graph: skills → candidate companies with rationale and
 *      likely direct-entry channels (ATS career pages, GitHub, communities)
 *   2. Cold email drafting: per-company pitch referencing their business
 *
 * Compliance note: the ATS-scanning loop itself is per-company USER-TRIGGERED
 * (extension button on the page the user is already viewing) — this module
 * only does LLM reasoning and drafting, never batch scraping.
 */
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { extractJson } from '../jd/tagger.js';

export const companyListSchema = z.object({
  companies: z
    .array(
      z.object({
        company: z.string().min(1).max(100),
        domain: z.string().max(200).default(''),
        why: z.string().max(200),
        likelyChannels: z.array(z.string().max(100)).max(5).default([]),
      }),
    )
    .min(1)
    .max(50),
});
export type CompanyList = z.infer<typeof companyListSchema>;

export const coldEmailSchema = z.object({
  subject: z.string().min(1).max(100),
  body: z.string().min(1).max(2000),
});
export type ColdEmail = z.infer<typeof coldEmailSchema>;

export function buildCompanyListPrompt(skills: string[], cities?: string[], count = 20): string {
  return `你是求职战略顾问。根据求职者技能，推演一批「可能正在招这类人」的目标公司清单。

求职者技能：${skills.join('、')}
意向城市：${cities?.length ? cities.join('、') : '不限'}
目标数量：${count} 家

输出 JSON：
{
  "companies": [
    {
      "company": "公司名",
      "domain": "官网域名（能推断的写，不确定留空）",
      "why": "为什么这家公司大概率需要这些技能（一句话，结合其业务）",
      "likelyChannels": ["直连入口：官网招聘页/ATS 系统/GitHub 组织/技术社区/内推渠道"]
    }
  ]
}
规则：优先列出真实存在、业务与该技能强相关的公司（大厂事业部 + 独角兽 + 垂直领域公司都要有）；不编造公司名。`;
}

export function parseCompanyList(text: string): CompanyList {
  const raw = JSON.parse(extractJson(text)) as unknown;
  return companyListSchema.parse(raw);
}

export function buildColdEmailPrompt(
  company: string,
  skills: string[],
  resume?: string,
  context?: string,
): string {
  const resumePart = resume ? `\n\n求职者简历（Markdown）：\n${resume.slice(0, 4000)}` : '';
  const contextPart = context ? `\n\n关于该公司的背景：\n${context.slice(0, 1500)}` : '';
  return `你是求职顾问。为求职者写一封投给「${company}」技术负责人/招聘负责人的冷邮件（直连自荐信）。

求职者技能：${skills.join('、')}${resumePart}${contextPart}

要求：
1. 主题 15 字以内，突出价值（如「5 年后端（高并发方向），想聊聊 ${company} 的机会」）
2. 正文 150-250 字：一句自我介绍 → 与对方业务相关的具体能力/成果 → 明确意向 → 附简历请求
3. 中文，真诚专业，不吹捧不卑微
4. 只输出 JSON：{"subject": "主题", "body": "正文"}（body 里用 \\n 换行）`;
}

export function parseColdEmail(text: string): ColdEmail {
  const raw = JSON.parse(extractJson(text)) as unknown;
  return coldEmailSchema.parse(raw);
}

export async function huntCompanies(
  provider: ChatProvider,
  skills: string[],
  cities: string[] | undefined,
  count: number,
  log: Logger,
): Promise<CompanyList> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildCompanyListPrompt(skills, cities, count) }],
    temperature: 0.3,
    maxTokens: 3000,
  };
  try {
    const result = await provider.chat(req);
    return parseCompanyList(result.text);
  } catch (err) {
    log.warn(`hunt: first attempt failed (${(err as Error).message}), retrying once`);
    const result = await provider.chat(req);
    return parseCompanyList(result.text);
  }
}

export async function draftColdEmail(
  provider: ChatProvider,
  company: string,
  skills: string[],
  resume: string | undefined,
  context: string | undefined,
  log: Logger,
): Promise<ColdEmail> {
  const req: ChatRequest = {
    messages: [{ role: 'user', content: buildColdEmailPrompt(company, skills, resume, context) }],
    temperature: 0.4,
    maxTokens: 1200,
  };
  const result = await provider.chat(req);
  log.debug(`hunt: cold email drafted (${result.usage.outputTokens} out tokens)`);
  return parseColdEmail(result.text);
}
