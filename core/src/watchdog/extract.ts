/**
 * LLM extraction: raw posts (HN comments / V2EX topics / GitHub repos) →
 * structured job entries. Batched JSON-mode calls, zod validated.
 */
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { Logger } from '../logger.js';
import { extractJson } from '../jd/tagger.js';
import type { RawItem } from './sources.js';

export const jobEntrySchema = z.object({
  company: z.string().min(1).max(100),
  role: z.string().min(1).max(150),
  tech: z.string().max(200).default(''),
  location: z.string().max(100).default(''),
  remote: z.boolean().optional(),
  contact: z.string().max(200).default(''),
  link: z.string().max(300).default(''),
  note: z.string().max(200).default(''),
});
export type JobEntry = z.infer<typeof jobEntrySchema>;

const batchResultSchema = z.object({
  jobs: z.array(jobEntrySchema).max(10),
});

const BATCH_SIZE = 8;

export function buildExtractPrompt(items: RawItem[]): string {
  const list = items
    .map((it, i) => `${i}. [${it.source}] ${it.title}\n${it.text}\nURL: ${it.url}`)
    .join('\n\n---\n\n');
  return `你是招聘信息抽取器。从下面的帖子中抽取真实招聘信息（岗位直招/远程机会）。不是招聘内容的跳过。

${list}

只输出 JSON：
{
  "jobs": [
    {
      "company": "公司/团队名",
      "role": "岗位名称",
      "tech": "技术栈关键词，逗号分隔",
      "location": "城市/远程",
      "remote": true/false,
      "contact": "投递方式（邮箱/链接文字，≤50字）",
      "link": "原文链接",
      "note": "薪资/亮点等补充信息（≤50字，没有则空）"
    }
  ]
}
规则：不编造帖子中不存在的信息；薪资未提及就留空 note。`;
}

export function parseBatch(text: string): JobEntry[] {
  const raw = JSON.parse(extractJson(text)) as unknown;
  return batchResultSchema.parse(raw).jobs;
}

export async function extractJobs(
  provider: ChatProvider,
  items: RawItem[],
  log: Logger,
): Promise<JobEntry[]> {
  const jobs: JobEntry[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const req: ChatRequest = {
      messages: [{ role: 'user', content: buildExtractPrompt(batch) }],
      temperature: 0.1,
      maxTokens: 2000,
    };
    try {
      const result = await provider.chat(req);
      const extracted = parseBatch(result.text);
      // Attach the originating link when the model left it empty
      for (let j = 0; j < extracted.length; j += 1) {
        const entry = extracted[j]!;
        if (!entry.link && batch[j]?.url) entry.link = batch[j]!.url;
      }
      jobs.push(...extracted);
    } catch (err) {
      log.warn(`watchdog: batch extraction failed (${(err as Error).message}), skipping ${batch.length} items`);
    }
  }
  return jobs;
}
