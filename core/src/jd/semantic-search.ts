/**
 * Semantic reverse search — the natural-language JD search the platforms
 * refuse to build ("找个不用加班、深入懂 RAG、学历要求不严的后端岗").
 *
 * Pipeline (Phase 2a, no embeddings needed):
 *   1. LLM translates the query into structured search tags
 *   2. Tag-based coarse filter over the local JD store
 *   3. LLM rerank of the top candidates against the original query → top 5
 */
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import type { JdRecord } from './schema.js';
import type { JdStore } from './store.js';
import { extractJson } from './tagger.js';

const intentSchema = z.object({
  techStack: z.array(z.string().trim().min(1)).max(20).default([]),
  workHours: z.enum(['双休', '大小周', '单休', '弹性', '未标注']).optional(),
  degreeReq: z.enum(['不限', '大专', '本科', '硕士', '博士']).optional(),
  yearsReq: z.enum(['应届', '1-3', '3-5', '5-10', '10+', '不限']).optional(),
  /** Risk flags the user wants to AVOID (e.g. outsourcing, single_day_off). */
  excludeRisks: z.array(z.string().trim().min(1)).max(10).default([]),
  /** Whether the user explicitly wants remote work. */
  remoteOnly: z.boolean().optional(),
});
export type SearchIntent = z.infer<typeof intentSchema>;

const rerankSchema = z.object({
  top: z.array(z.object({ index: z.number().int().min(0), reason: z.string().max(80) })).max(5),
});

const MAX_CANDIDATES = 12;
const TOP_K = 5;

export function buildIntentPrompt(query: string): string {
  return `把求职者的自然语言搜索意图翻译成结构化筛选标签。

搜索语句："${query}"

只输出 JSON：
{
  "techStack": ["java"],                 // 只放具体技术/工具/框架关键词（小写英文，如 java、rag、kubernetes、llm）
  "workHours": "双休 | 大小周 | 单休 | 弹性 | 未标注",   // 未提及则不输出该字段
  "degreeReq": "不限 | 大专 | 本科 | 硕士 | 博士",      // 未提及则不输出
  "yearsReq": "应届 | 1-3 | 3-5 | 5-10 | 10+ | 不限",  // 未提及则不输出
  "excludeRisks": ["outsourcing"],       // 用户要避开的风险（外包→outsourcing、单休→single_day_off、试用期不交社保→no_social_insurance、无偿加班→unpaid_ot）；没有则 []
  "remoteOnly": true/false               // 明确要远程才为 true
}
规则：
- "不加班/双休" → workHours: "双休"；"学历要求不严/不限学历" → degreeReq: "不限"；"外包不要/拒绝外包" → excludeRisks 加 outsourcing
- 岗位角色词（后端、前端、工程师、开发、算法等）**不要**放进 techStack——只放具体技术词；语句里没有具体技术词就留空数组
- 不推测语句里没有的约束`;
}

export function parseIntent(text: string): SearchIntent {
  const raw = JSON.parse(extractJson(text)) as unknown;
  return intentSchema.parse(raw);
}

export function buildRerankPrompt(query: string, candidates: JdRecord[]): string {
  const list = candidates
    .map((r, i) => `${i}. ${r.title} @ ${r.company} | ${r.tags?.summary ?? ''} | 工时:${r.tags?.workHours ?? '未知'} | 薪资:${r.salaryText || '未知'}`)
    .join('\n');
  return `用户的搜索意图："${query}"

候选岗位（编号 0-${candidates.length - 1}）：
${list}

从候选里选出最符合意图的 ${TOP_K} 个（不足则全选），按匹配度降序输出 JSON：
{
  "top": [{"index": 编号, "reason": "一句话理由（≤30字）"}]
}`;
}

export function parseRerank(text: string, candidateCount: number): Array<{ index: number; reason: string }> {
  const raw = JSON.parse(extractJson(text)) as unknown;
  const parsed = rerankSchema.parse(raw);
  return parsed.top.filter((t) => t.index < candidateCount).slice(0, TOP_K);
}

export interface SemanticSearchResult {
  query: string;
  intent: SearchIntent;
  matched: number;
  results: Array<{ record: JdRecord; reason?: string }>;
}

export async function semanticSearch(
  provider: ChatProvider,
  store: JdStore,
  query: string,
  log: Logger,
): Promise<SemanticSearchResult> {
  // 1. Query → structured intent
  const intentReq: ChatRequest = {
    messages: [{ role: 'user', content: buildIntentPrompt(query) }],
    temperature: 0.1,
    maxTokens: 800,
  };
  const intent = parseIntent((await provider.chat(intentReq)).text);
  log.debug(`semantic-search: intent=${JSON.stringify(intent)}`);

  // 2. Coarse tag filter (excluding risk flags the user wants to avoid)
  const records = store.searchByTags({
    techStack: intent.techStack,
    riskFlags: [],
    excludeRiskFlags: intent.excludeRisks,
    workHours: intent.workHours,
    degreeReq: intent.degreeReq,
    yearsReq: intent.yearsReq,
    remote: intent.remoteOnly,
  });

  // 3. Rerank when the candidate pool is larger than TOP_K
  if (records.length <= TOP_K) {
    return { query, intent, matched: records.length, results: records.map((record) => ({ record })) };
  }
  const candidates = records
    .sort((a, b) => (b.capturedAt ?? '').localeCompare(a.capturedAt ?? ''))
    .slice(0, MAX_CANDIDATES);
  const rerankReq: ChatRequest = {
    messages: [{ role: 'user', content: buildRerankPrompt(query, candidates) }],
    temperature: 0.2,
    maxTokens: 800,
  };
  const top = parseRerank((await provider.chat(rerankReq)).text, candidates.length);
  return {
    query,
    intent,
    matched: records.length,
    results: top.map((t) => ({ record: candidates[t.index]!, reason: t.reason })),
  };
}
