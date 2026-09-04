/**
 * Shared generation-preference feedback store — thumbs + reason tags + note,
 * aggregated into "personal rules" injected into the greeting prompt.
 *
 * This is the core-side bank the desktop App writes to (the browser extension
 * keeps its own chrome.storage bank — see extension/src/direct/feedback.ts —
 * the semantics below are kept identical so both adapt the model the same way).
 * Prompt adaptation, NOT fine-tuning. Local-only file (~/.tomi-job-hunt/
 * feedback.jsonl): the App never contacts chrome.storage, so a shared store
 * on the gateway (which both App and extension-mode core already talk to) is
 * the natural convergence point.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logger.js';

export const MAX_FEEDBACK = 200;

/** Selectable complaint tags (id → UI label). */
export const FEEDBACK_TAGS: Record<string, string> = {
  'too-long': '太长',
  'too-stiff': '太官腔/太书面',
  'no-highlight': '没突出亮点',
  'mismatch-jd': '不匹配JD',
  'too-generic': '太笼统/模板感',
  'wrong-tone': '语气不合适',
  'too-flattering': '吹捧/谄媚',
  'not-ask': '结尾没提问/没行动',
};

/** Complaint tag → durable preference sentence for the greeting prompt. */
const TAG_RULES: Record<string, string> = {
  'too-long': '打招呼语不要太长，删掉套话，控制字数',
  'too-stiff': '打招呼语要口语化，去掉官腔和书面语',
  'no-highlight': '打招呼语要突出简历中最匹配的核心亮点',
  'mismatch-jd': '打招呼语要更贴合目标 JD 的要求',
  'too-generic': '打招呼语要具体，不要模板化套话',
  'wrong-tone': '注意语气分寸，不要过于随意或冒犯',
  'too-flattering': '打招呼语不要吹捧和谄媚',
  'not-ask': '打招呼语结尾要带一个具体问题或行动',
};

export interface FeedbackEntry {
  /** 'greeting' | 'match' | ... — 用户评价对应的操作类型 */
  feature: string;
  ts: number;
  thumbs?: 'up' | 'down';
  tags: string[];
  note?: string;
}

/**
 * Turns down-thumbs (tag → rule sentence), recent notes and up-thumb counts
 * into a short "how to write for this user" block. Empty store → ''.
 */
export function aggregatePersonalRules(entries: FeedbackEntry[]): string {
  const lines: string[] = [];

  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.thumbs !== 'down') continue;
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  for (const [tag, count] of tagCounts) {
    const rule = TAG_RULES[tag];
    if (rule) lines.push(rule + (count > 1 ? `（${count} 次）` : ''));
  }

  const upCount = entries.filter((e) => e.thumbs === 'up').length;
  if (upCount >= 3) lines.push(`用户认可了 ${upCount} 条打招呼语，继续保持这种风格`);

  const notes = entries
    .map((e) => e.note?.trim())
    .filter((n): n is string => !!n)
    .slice(-5);
  for (const n of notes) lines.push(`用户补充：${n.slice(0, 200)}`);

  return lines.join('\n');
}

/** Wraps rules with a marker so the existing greeting-prompt feedback line reads correctly. */
export function personalRulesPrompt(rules: string): string {
  const r = rules.trim();
  return r ? `[长期偏好规则] 用户希望：\n${r}` : '';
}

export class FeedbackStore {
  private readonly entries: FeedbackEntry[] = [];
  private readonly filePath: string;

  constructor(
    private readonly configDir: string,
    private readonly log: Logger,
  ) {
    mkdirSync(configDir, { recursive: true });
    this.filePath = join(configDir, 'feedback.jsonl');
    this.load();
  }

  get path(): string {
    return this.filePath;
  }

  get size(): number {
    return this.entries.length;
  }

  /** Appends one entry (newest last), keeping the tail window on disk too. */
  add(input: Omit<FeedbackEntry, 'ts'>): FeedbackEntry {
    const entry: FeedbackEntry = { ...input, ts: Date.now() };
    this.entries.push(entry);
    const over = this.entries.length - MAX_FEEDBACK;
    if (over > 0) {
      // Trim the in-memory tail AND rewrite the file — otherwise reloading
      // would resurrect every trimmed line from the append-only JSONL.
      this.entries.splice(0, over);
      writeFileSync(this.filePath, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''), 'utf8');
    } else {
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    }
    this.log.debug(`feedback: ${entry.thumbs ?? 'note'} on ${entry.feature} (${this.entries.length} total)`);
    return entry;
  }

  /** All stored entries, oldest first (== file order). */
  list(): FeedbackEntry[] {
    return [...this.entries];
  }

  /** Newest first — handy for a UI list. */
  recent(limit = 20): FeedbackEntry[] {
    return [...this.entries].reverse().slice(0, limit);
  }

  /** Aggregated personal-rules block (injectable string), '' when empty. */
  rules(): string {
    return aggregatePersonalRules(this.entries);
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as FeedbackEntry;
        if (typeof entry?.ts !== 'number' || typeof entry.feature !== 'string') continue;
        this.entries.push(entry);
      } catch (err) {
        this.log.warn(`feedback: skipping corrupt line: ${(err as Error).message}`);
      }
    }
  }
}
