import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JdStore } from './store.js';
import { Logger } from '../logger.js';
import type { JdRecord } from './schema.js';

const silentLog = new Logger('error', 'test');

function makeRecord(company: string, title: string, tags?: JdRecord['tags']): JdRecord {
  return {
    jobUid: `${company}-${title}`,
    source: 'manual',
    url: `https://example.com/${company}/${title}`,
    title,
    company,
    salaryText: '20-30K',
    requirements: '熟悉 Java',
    capturedAt: new Date().toISOString(),
    tags,
  };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'tomi-store-'));
}

describe('JdStore', () => {
  it('saves, finds and lists records', () => {
    const dir = tmpDir();
    const store = new JdStore(dir, silentLog);
    store.save(makeRecord('A公司', '后端'));
    store.save(makeRecord('B公司', '前端'));
    expect(store.size).toBe(2);
    expect(store.findByUid('A公司-后端')?.company).toBe('A公司');
    expect(store.listRecent(10)).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists across instances (JSONL reload, latest wins)', () => {
    const dir = tmpDir();
    const store1 = new JdStore(dir, silentLog);
    const rec = makeRecord('A公司', '后端');
    store1.save(rec);
    store1.updateTags('A公司-后端', {
      techStack: ['java'],
      riskFlags: [],
      summary: '后端岗位',
    });

    const store2 = new JdStore(dir, silentLog); // reload from disk
    const loaded = store2.findByUid('A公司-后端');
    expect(loaded?.tags?.techStack).toEqual(['java']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores and reloads reports', () => {
    const dir = tmpDir();
    const store = new JdStore(dir, silentLog);
    store.save(makeRecord('A公司', '后端'));
    store.addReport('A公司-后端', { type: 'outsourcing' });
    store.addReport('A公司-后端', { type: 'unpaid_ot', note: '经常加班到十点' });

    const reloaded = new JdStore(dir, silentLog);
    const reports = reloaded.getReports('A公司-后端');
    expect(reports).toHaveLength(2);
    expect(reports[0]?.type).toBe('outsourcing');
    expect(reports[0]?.ts).toBeTruthy();
    expect(reports[1]?.note).toBe('经常加班到十点');
    rmSync(dir, { recursive: true, force: true });
  });

  it('searches by tags', () => {
    const dir = tmpDir();
    const store = new JdStore(dir, silentLog);
    store.save(
      makeRecord('A公司', '后端', {
        techStack: ['java', 'k8s'],
        riskFlags: ['outsourcing'],
        workHours: '双休',
        summary: 'x',
      }),
    );
    store.save(
      makeRecord('B公司', '前端', {
        techStack: ['react'],
        riskFlags: [],
        workHours: '单休',
        summary: 'y',
      }),
    );
    store.save(makeRecord('C公司', '未打标岗位'));

    expect(store.searchByTags({ techStack: ['java'], riskFlags: [], workHours: undefined })).toHaveLength(1);
    expect(store.searchByTags({ techStack: [], riskFlags: ['outsourcing'], workHours: undefined })).toHaveLength(1);
    expect(store.searchByTags({ techStack: [], riskFlags: [], workHours: '双休' })).toHaveLength(1);
    // empty filters return all tagged records; the untagged record never matches
    expect(store.searchByTags({ techStack: [], riskFlags: [], workHours: undefined })).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });
});
