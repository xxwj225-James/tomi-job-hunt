import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FeedbackStore, aggregatePersonalRules, personalRulesPrompt } from './feedback.js';
import { Logger } from '../logger.js';

const silentLog = new Logger('error', 'test');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'tomi-feedback-'));
}

describe('feedback aggregation', () => {
  it('turns repeated down-thumb tags into preference sentences with counts', () => {
    const rules = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'down', tags: ['too-long'] },
      { feature: 'greeting', ts: 2, thumbs: 'down', tags: ['too-long', 'too-stiff'] },
    ]);
    expect(rules).toContain('打招呼语不要太长，删掉套话，控制字数（2 次）');
    expect(rules).toContain('打招呼语要口语化，去掉官腔和书面语');
  });

  it('records up-thumb recognition only after 3+', () => {
    const three = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'up', tags: [] },
      { feature: 'greeting', ts: 2, thumbs: 'up', tags: [] },
      { feature: 'greeting', ts: 3, thumbs: 'up', tags: [] },
    ]);
    expect(three).toContain('用户认可了 3 条打招呼语，继续保持这种风格');
    const two = aggregatePersonalRules([
      { feature: 'greeting', ts: 1, thumbs: 'up', tags: [] },
      { feature: 'greeting', ts: 2, thumbs: 'up', tags: [] },
    ]);
    expect(two).toBe('');
  });

  it('includes the last 5 notes as 用户补充 lines', () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      feature: 'greeting',
      ts: i,
      tags: [] as string[],
      note: `note-${i}`,
    }));
    const rules = aggregatePersonalRules(entries);
    expect(rules).toContain('用户补充：note-6');
    expect(rules).toContain('用户补充：note-2');
    expect(rules).not.toContain('note-1');
  });

  it('returns empty string for an empty store and prompt wrapper gates on it', () => {
    expect(aggregatePersonalRules([])).toBe('');
    expect(personalRulesPrompt('')).toBe('');
    expect(personalRulesPrompt('a\nb')).toBe('[长期偏好规则] 用户希望：\na\nb');
  });
});

describe('FeedbackStore', () => {
  it('persists entries across instances and keeps the tail window', () => {
    const dir = tmpDir();
    const store = new FeedbackStore(dir, silentLog);
    store.add({ feature: 'greeting', thumbs: 'down', tags: ['too-long'], note: '短一点' });
    store.add({ feature: 'match', thumbs: 'up', tags: [] });

    const reloaded = new FeedbackStore(dir, silentLog);
    expect(reloaded.list()).toHaveLength(2);
    expect(reloaded.rules()).toContain('短一点');

    // Tail window: only the newest MAX_FEEDBACK survive the trim.
    const big = new FeedbackStore(dir, silentLog);
    for (let i = 0; i < 250; i++) big.add({ feature: 'greeting', tags: [], note: `n${i}` });
    const after = new FeedbackStore(dir, silentLog);
    expect(after.size).toBe(200);
    expect(after.list().at(-1)?.note).toBe('n249');
    rmSync(dir, { recursive: true, force: true });
  });

  it('rules are available from the aggregate even with mixed features (match thumbs feed greeting rules)', () => {
    const dir = tmpDir();
    const store = new FeedbackStore(dir, silentLog);
    store.add({ feature: 'match', thumbs: 'up', tags: [] });
    store.add({ feature: 'match', thumbs: 'up', tags: [] });
    store.add({ feature: 'match', thumbs: 'up', tags: [] });
    expect(store.rules()).toContain('用户认可了 3 条打招呼语');
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips corrupt lines on load', () => {
    const dir = tmpDir();
    const store = new FeedbackStore(dir, silentLog);
    store.add({ feature: 'greeting', thumbs: 'down', tags: ['too-long'] });
    appendFileSync(join(dir, 'feedback.jsonl'), '{not-json}\n{"feature":"greeting"}\n', 'utf8');
    const reloaded = new FeedbackStore(dir, silentLog);
    expect(reloaded.size).toBe(1); // the good line only
    rmSync(dir, { recursive: true, force: true });
  });
});
