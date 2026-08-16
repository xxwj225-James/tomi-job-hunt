import { describe, expect, it } from 'vitest';
import {
  buildIntentPrompt,
  buildRerankPrompt,
  parseIntent,
  parseRerank,
} from './semantic-search.js';
import type { JdRecord } from './schema.js';

describe('parseIntent', () => {
  it('parses a full intent', () => {
    const intent = parseIntent(
      JSON.stringify({
        techStack: ['java', 'rag'],
        workHours: '双休',
        degreeReq: '不限',
        excludeRisks: ['outsourcing'],
        remoteOnly: false,
      }),
    );
    expect(intent.techStack).toEqual(['java', 'rag']);
    expect(intent.workHours).toBe('双休');
    expect(intent.degreeReq).toBe('不限');
    expect(intent.excludeRisks).toEqual(['outsourcing']);
  });

  it('applies defaults for optional fields', () => {
    const intent = parseIntent('{"techStack": ["go"]}');
    expect(intent.workHours).toBeUndefined();
    expect(intent.excludeRisks).toEqual([]);
    expect(intent.remoteOnly).toBeUndefined();
  });

  it('prompt explains risk-flag translation rules', () => {
    const prompt = buildIntentPrompt('不加班 拒绝外包');
    expect(prompt).toContain('不加班');
    expect(prompt).toContain('outsourcing');
    expect(prompt).toContain('excludeRisks');
  });
});

describe('parseRerank', () => {
  const candidates = Array.from({ length: 6 }, (_, i) => ({
    jobUid: `uid${i}`,
    source: 'manual' as const,
    url: 'u',
    title: `岗位${i}`,
    company: `公司${i}`,
    salaryText: '20K',
    requirements: 'x',
    capturedAt: '2026-08-16T00:00:00.000Z',
    tags: { techStack: [], riskFlags: [], summary: 's' },
  })) satisfies JdRecord[];

  it('parses rankings and filters out-of-range indexes', () => {
    const top = parseRerank(
      JSON.stringify({
        top: [
          { index: 2, reason: '最匹配' },
          { index: 99, reason: '越界' },
          { index: 4, reason: '次匹配' },
        ],
      }),
      candidates.length,
    );
    expect(top).toEqual([
      { index: 2, reason: '最匹配' },
      { index: 4, reason: '次匹配' },
    ]);
  });

  it('prompt includes the original query and candidates', () => {
    const prompt = buildRerankPrompt('懂 RAG 的后端', candidates.slice(0, 3));
    expect(prompt).toContain('懂 RAG 的后端');
    expect(prompt).toContain('岗位0 @ 公司0');
    expect(prompt).toContain('岗位2');
  });
});
