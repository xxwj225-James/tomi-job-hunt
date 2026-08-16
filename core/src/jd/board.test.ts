import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Board } from './board.js';
import { Logger } from '../logger.js';

const silentLog = new Logger('error', 'test');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'tomi-board-'));
}

describe('Board', () => {
  it('creates the kanban file with all sections', () => {
    const dir = tmpDir();
    const board = new Board(dir, silentLog);
    const content = readFileSync(board.path, 'utf8');
    for (const label of ['已打招呼', '已投简历', '面试中', '已 Offer', '已拒绝']) {
      expect(content).toContain(`## ${label}`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds entries under the right section and lists them back', () => {
    const dir = tmpDir();
    const board = new Board(dir, silentLog);
    board.add({ status: 'greeted', company: 'A公司', title: '后端', url: 'https://a.com' });
    board.add({ status: 'interview', company: 'B公司', title: '前端', url: '', note: '二面' });

    const entries = board.list();
    expect(entries).toHaveLength(2);
    const interviewed = entries.find((e) => e.status === 'interview');
    expect(interviewed?.company).toBe('B公司');
    expect(interviewed?.note).toBe('二面');
    expect(interviewed?.ts).toBeTruthy();

    // persisted across instances
    const reloaded = new Board(dir, silentLog).list();
    expect(reloaded).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('escapes pipes in company names', () => {
    const dir = tmpDir();
    const board = new Board(dir, silentLog);
    board.add({ status: 'greeted', company: 'A|B 公司', title: 'x', url: '' });
    expect(board.list()[0]?.company).toBe('A|B 公司');
    rmSync(dir, { recursive: true, force: true });
  });
});
