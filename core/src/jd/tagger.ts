/**
 * LLM tagging pipeline — turns a raw JD into structured JdTags.
 *
 * Reuses the existing ChatProvider abstraction (core/src/llm/), so every
 * provider (claude-code / claude-api / future DeepSeek-Qwen) works unchanged.
 * The prompt asks for JSON only; the response is normalized then validated
 * with zod. Failures never block capture — tags are simply absent.
 */
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { ChatProviderError } from '../llm/chat-provider.js';
import { jdTagsSchema, type JdTags } from './schema.js';

const TAG_SYSTEM_PROMPT =
  '你是招聘信息结构化分析助手。只输出 JSON，不要输出任何解释或 markdown 代码块。';

function buildPrompt(jd: {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}): string {
  return `请分析以下招聘信息，提取结构化标签。

岗位：${jd.title}
公司：${jd.company}
薪资：${jd.salaryText || '未标注'}
任职要求原文：
${jd.requirements || '未提供'}

输出 JSON，格式如下：
{
  "techStack": ["string"],           // 技术栈/技能关键词，尽量小写英文（如 java, k8s, rag）
  "yearsReq": "应届 | 1-3 | 3-5 | 5-10 | 10+ | 不限",
  "degreeReq": "不限 | 大专 | 本科 | 硕士 | 博士",
  "workHours": "双休 | 大小周 | 单休 | 弹性 | 未标注",  // 原文未提及则"未标注"
  "salaryBandK": [min, max],         // 月薪范围，单位 k，数字；无法解析则省略该字段
  "riskFlags": ["string"],           // 风险信号枚举: outsourcing/salary_inflated/unpaid_ot/no_social_insurance/vague_responsibility，无则 []
  "remote": true/false,              // 明确远程才为 true，否则省略该字段
  "summary": "string"                // 不超过50字的客观岗位摘要
}
注意：不推测原文没有的信息；workHours 未提及就填"未标注"；summary 用客观陈述。`;
}

/** Extracts the first balanced {...} JSON object from an LLM reply. */
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

/** Maps LLM output variants to the enum values the schema expects. */
export function normalizeRawTags(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Tag response must be a JSON object');
  }
  const tags = { ...(raw as Record<string, unknown>) };

  // Ranges before single digits: "3-5年" must not match the "5年" rule.
  const yearMap: Array<[RegExp, string]> = [
    [/10\s*[年+]/, '10+'],
    [/5\s*[-~至到]\s*10/, '5-10'],
    [/3\s*[-~至到]\s*5/, '3-5'],
    [/1\s*[-~至到]\s*3/, '1-3'],
    [/应届|毕业/, '应届'],
    [/5\s*[年+]/, '5-10'],
    [/3\s*[年+]/, '3-5'],
    [/1\s*[年+]/, '1-3'],
    [/不限|无经验|经验不限/, '不限'],
  ];
  if (typeof tags.yearsReq === 'string') {
    tags.yearsReq = yearMap.find(([re]) => re.test(tags.yearsReq as string))?.[1] ?? '不限';
  } else {
    delete tags.yearsReq;
  }

  const degreeMap: Array<[RegExp, string]> = [
    [/博士/, '博士'],
    [/硕士|研究生/, '硕士'],
    [/本科/, '本科'],
    [/大专|专科/, '大专'],
    [/不限|学历不限/, '不限'],
  ];
  if (typeof tags.degreeReq === 'string') {
    tags.degreeReq = degreeMap.find(([re]) => re.test(tags.degreeReq as string))?.[1] ?? '不限';
  } else {
    delete tags.degreeReq;
  }

  const hoursMap: Array<[RegExp, string]> = [
    [/996/, '单休'],
    [/大小周/, '大小周'],
    [/单休/, '单休'],
    [/双休/, '双休'],
    [/弹性/, '弹性'],
  ];
  if (typeof tags.workHours === 'string') {
    tags.workHours = hoursMap.find(([re]) => re.test(tags.workHours as string))?.[1] ?? '未标注';
  } else {
    delete tags.workHours;
  }

  if (Array.isArray(tags.salaryBandK)) {
    const band = tags.salaryBandK.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v >= 0);
    if (band.length === 2 && band[0]! <= band[1]!) tags.salaryBandK = [band[0], band[1]];
    else delete tags.salaryBandK;
  } else {
    delete tags.salaryBandK;
  }

  // Truncate rather than fail — the schema keeps max(50) as a hard boundary.
  if (typeof tags.summary === 'string') {
    tags.summary = tags.summary.trim().slice(0, 50);
  }

  return tags;
}

/** Parses and validates an LLM tag response. Pure — unit-testable. */
export function parseTagResponse(text: string): JdTags {
  const json = extractJson(text);
  const raw = JSON.parse(json) as unknown;
  return jdTagsSchema.parse(normalizeRawTags(raw));
}

/** Tags a JD via the configured provider. Throws on invalid output. */
export async function tagJd(
  provider: ChatProvider,
  jd: { title: string; company: string; salaryText: string; requirements: string },
  log: Logger,
): Promise<JdTags> {
  const req: ChatRequest = {
    messages: [
      { role: 'system', content: TAG_SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(jd) },
    ],
    temperature: 0.1,
  };
  const result = await provider.chat(req);
  log.debug(`tagger: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
  return parseTagResponse(result.text);
}

/** tagJd with one retry (JSON parse or validation can fail transiently). */
export async function tagJdWithRetry(
  provider: ChatProvider,
  jd: { title: string; company: string; salaryText: string; requirements: string },
  log: Logger,
): Promise<JdTags> {
  try {
    return await tagJd(provider, jd, log);
  } catch (err) {
    // Provider/network errors won't improve on a second call — retrying only
    // doubles the wait (each claude-code call costs 30s+). Retry only when
    // the failure was a parse/validation flake.
    if (err instanceof ChatProviderError) throw err;
    log.warn(`tagger: first attempt failed (${(err as Error).message}), retrying once`);
    return await tagJd(provider, jd, log);
  }
}
