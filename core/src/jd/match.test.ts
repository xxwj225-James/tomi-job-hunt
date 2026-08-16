import { describe, expect, it } from 'vitest';
import { buildMatchPrompt, parseMatchResponse } from './match.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K·14薪',
  requirements: '熟悉 Java、Redis、K8s，3-5 年经验',
};

describe('buildMatchPrompt', () => {
  it('includes JD and resume, asks for JSON only', () => {
    const prompt = buildMatchPrompt(jd, '# 简历\n- Java 5 年');
    expect(prompt).toContain('高级后端工程师');
    expect(prompt).toContain('Java 5 年');
    expect(prompt).toContain('只输出 JSON');
  });

  it('notes when resume is missing', () => {
    expect(buildMatchPrompt(jd)).toContain('未提供简历');
  });
});

describe('parseMatchResponse', () => {
  it('parses a valid response and rounds the score', () => {
    const result = parseMatchResponse(
      '```json\n' +
        JSON.stringify({
          score: 82.4,
          verdict: '强烈推荐',
          strengths: ['5 年 Java 匹配 3-5 年要求', '熟悉 K8s'],
          gaps: ['缺少大模型经验'],
          risks: ['试用期不交社保'],
        }) +
        '\n```',
    );
    expect(result.score).toBe(82);
    expect(result.verdict).toBe('强烈推荐');
    expect(result.strengths).toHaveLength(2);
    expect(result.risks).toEqual(['试用期不交社保']);
  });

  it('applies defaults for missing arrays', () => {
    const result = parseMatchResponse('{"score": 50, "verdict": "推荐"}');
    expect(result.strengths).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it('rejects out-of-range scores but tolerates free-form verdicts', () => {
    expect(() => parseMatchResponse('{"score": 150, "verdict": "推荐"}')).toThrow();
    // verdict is intentionally tolerant — LLM wording varies between runs
    expect(parseMatchResponse('{"score": 50, "verdict": "可以考虑"}').verdict).toBe('可以考虑');
  });
});
