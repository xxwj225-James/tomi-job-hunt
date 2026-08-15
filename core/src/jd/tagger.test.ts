import { describe, expect, it } from 'vitest';
import { extractJson, normalizeRawTags, parseTagResponse } from './tagger.js';

describe('extractJson', () => {
  it('extracts a bare JSON object', () => {
    const text = '{"a": 1}';
    expect(extractJson(text)).toBe('{"a": 1}');
  });

  it('extracts JSON from inside prose and markdown fences', () => {
    const text = '好的，结果如下：\n```json\n{"a": {"b": [1, 2]}}\n```\n希望有帮助';
    expect(extractJson(text)).toBe('{"a": {"b": [1, 2]}}');
  });

  it('handles nested braces and strings containing braces', () => {
    const text = '{"summary": "熟悉 {Java} 后端", "list": [1, 2]}';
    expect(extractJson(text)).toBe(text);
  });

  it('throws when no JSON object exists', () => {
    expect(() => extractJson('没有任何 JSON')).toThrow(/No JSON/);
  });
});

describe('normalizeRawTags', () => {
  it('maps free-form years/degree/workHours to enum values', () => {
    const normalized = normalizeRawTags({
      yearsReq: '要求 3-5 年工作经验',
      degreeReq: '本科及以上学历',
      workHours: '周末双休，不加班',
    });
    expect(normalized.yearsReq).toBe('3-5');
    expect(normalized.degreeReq).toBe('本科');
    expect(normalized.workHours).toBe('双休');
  });

  it('falls back to 未标注 when work hours are unknown', () => {
    const normalized = normalizeRawTags({ workHours: '工作时间面议' });
    expect(normalized.workHours).toBe('未标注');
  });

  it('sanitizes malformed salary bands', () => {
    expect(normalizeRawTags({ salaryBandK: ['20', '30'] }).salaryBandK).toEqual([20, 30]);
    expect(normalizeRawTags({ salaryBandK: ['abc', '30'] }).salaryBandK).toBeUndefined();
    expect(normalizeRawTags({ salaryBandK: [40, 10] }).salaryBandK).toBeUndefined();
  });

  it('maps 996 to 单休', () => {
    expect(normalizeRawTags({ workHours: '996 大小周说不清' }).workHours).toBe('单休');
  });

  it('truncates over-long summaries instead of failing', () => {
    const summary = '很'.repeat(120);
    const normalized = normalizeRawTags({ summary });
    expect((normalized.summary as string).length).toBe(50);
  });
});

describe('parseTagResponse', () => {
  it('parses a full valid response', () => {
    const tags = parseTagResponse(
      '```json\n' +
        JSON.stringify({
          techStack: ['java', 'redis'],
          yearsReq: '3-5年',
          degreeReq: '本科',
          workHours: '双休',
          salaryBandK: [25, 40],
          riskFlags: ['unpaid_ot'],
          remote: false,
          summary: '负责高并发订单系统的后端开发',
        }) +
        '\n```',
    );
    expect(tags.techStack).toEqual(['java', 'redis']);
    expect(tags.yearsReq).toBe('3-5');
    expect(tags.salaryBandK).toEqual([25, 40]);
    expect(tags.riskFlags).toEqual(['unpaid_ot']);
  });

  it('applies defaults for missing optional fields', () => {
    const tags = parseTagResponse('{"summary": "一个岗位"}');
    expect(tags.techStack).toEqual([]);
    expect(tags.riskFlags).toEqual([]);
    expect(tags.yearsReq).toBeUndefined();
  });

  it('throws on invalid output', () => {
    expect(() => parseTagResponse('{"summary": "x", "techStack": "java"}')).toThrow();
    expect(() => parseTagResponse('{"techStack": []}')).toThrow(); // missing summary
    expect(() => parseTagResponse('not json at all')).toThrow();
  });
});
