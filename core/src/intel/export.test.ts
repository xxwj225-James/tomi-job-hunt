import { describe, expect, it } from 'vitest';
import { mergeFeed } from './export.js';
import type { SharedIntel } from '../jd/schema.js';

function entry(overrides: Partial<SharedIntel>): SharedIntel {
  return {
    jobUid: 'uid1',
    source: 'zhipin',
    capturedAt: '2026-08-16T00:00:00.000Z',
    tags: null,
    reports: [],
    ...overrides,
  };
}

describe('mergeFeed', () => {
  it('merges entries by jobUid and dedupes reports', () => {
    const existing = [
      entry({
        jobUid: 'uid1',
        tags: { techStack: ['java'], riskFlags: [], summary: '旧标签' },
        reports: [{ type: 'outsourcing', ts: '2026-08-01T00:00:00.000Z' }],
      }),
    ];
    const incoming = [
      entry({
        jobUid: 'uid1',
        tags: { techStack: ['java', 'k8s'], riskFlags: [], summary: '新标签' },
        reports: [
          { type: 'outsourcing', ts: '2026-08-01T00:00:00.000Z' }, // duplicate
          { type: 'unpaid_ot', ts: '2026-08-10T00:00:00.000Z' },
        ],
      }),
      entry({ jobUid: 'uid2' }),
    ];
    const merged = mergeFeed(existing, incoming);
    expect(merged).toHaveLength(2);
    const uid1 = merged.find((e) => e.jobUid === 'uid1')!;
    expect(uid1.tags?.summary).toBe('新标签'); // newest tags win
    expect(uid1.reports).toHaveLength(2); // deduped by type+ts
  });

  it('sorts entries by jobUid', () => {
    const merged = mergeFeed([entry({ jobUid: 'b' })], [entry({ jobUid: 'a' })]);
    expect(merged.map((e) => e.jobUid)).toEqual(['a', 'b']);
  });

  it('handles empty existing feed', () => {
    expect(mergeFeed([], [entry({ jobUid: 'x' })])).toHaveLength(1);
  });
});
