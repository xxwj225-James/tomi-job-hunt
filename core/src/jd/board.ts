/**
 * Job application tracker — a local markdown kanban
 * (~/.tomi-job-hunt/board.md): 已打招呼 → 已投简历 → 面试中 → Offer → 已拒绝.
 * Human-readable (open/edit in any editor) and API-addressable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logger.js';

export const BOARD_STATUSES = ['greeted', 'applied', 'interview', 'offer', 'rejected'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const STATUS_LABELS: Record<BoardStatus, string> = {
  greeted: '已打招呼',
  applied: '已投简历',
  interview: '面试中',
  offer: '已 Offer',
  rejected: '已拒绝',
};

export interface BoardEntry {
  ts: string;
  status: BoardStatus;
  company: string;
  title: string;
  url: string;
  note?: string;
}

const HEADER = `# TomiHunt 求职看板

> 本文件由 TomiHunt 维护，也可以手动编辑（每行一条：| 日期 | 公司 | 岗位 | 链接 | 备注 |）。

## 已打招呼
## 已投简历
## 面试中
## 已 Offer
## 已拒绝
`;

export class Board {
  private readonly filePath: string;

  constructor(
    private readonly configDir: string,
    private readonly log: Logger,
  ) {
    mkdirSync(configDir, { recursive: true });
    this.filePath = join(configDir, 'board.md');
    if (!existsSync(this.filePath)) writeFileSync(this.filePath, HEADER, 'utf8');
  }

  add(entry: Omit<BoardEntry, 'ts'>): BoardEntry {
    const stored: BoardEntry = { ...entry, ts: new Date().toISOString() };
    const line = `| ${stored.ts.slice(0, 10)} | ${escapePipe(stored.company)} | ${escapePipe(stored.title)} | ${stored.url} | ${escapePipe(stored.note ?? '')} |\n`;
    // Insert under the matching status section (sections are in BOARD_STATUSES order)
    let content = readFileSync(this.filePath, 'utf8');
    const heading = `## ${STATUS_LABELS[stored.status]}`;
    const idx = content.indexOf(heading);
    if (idx < 0) {
      content += `\n## ${STATUS_LABELS[stored.status]}\n${line}`;
    } else {
      const lineEnd = content.indexOf('\n', idx) + 1;
      content = `${content.slice(0, lineEnd)}${line}${content.slice(lineEnd)}`;
    }
    writeFileSync(this.filePath, content, 'utf8');
    this.log.info(`board: ${stored.status} ${stored.company} — ${stored.title}`);
    return stored;
  }

  list(): BoardEntry[] {
    const content = readFileSync(this.filePath, 'utf8');
    const entries: BoardEntry[] = [];
    let current: BoardStatus | null = null;
    for (const line of content.split('\n')) {
      const heading = /^## (.+)$/.exec(line);
      if (heading) {
        const label = heading[1]!;
        current = (BOARD_STATUSES.find((s) => STATUS_LABELS[s] === label) ?? null);
        continue;
      }
      const row = /^\| (\d{4}-\d{2}-\d{2}) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/.exec(line);
      if (row && current) {
        entries.push({
          ts: row[1]!,
          status: current,
          company: unescapePipe(row[2]!),
          title: unescapePipe(row[3]!),
          url: row[4]!,
          note: row[5] ? unescapePipe(row[5]) : undefined,
        });
      }
    }
    return entries;
  }

  get path(): string {
    return this.filePath;
  }
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function unescapePipe(text: string): string {
  return text.replace(/\\\|/g, '|');
}
