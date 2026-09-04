import { describe, expect, it } from 'vitest';
import {
  buildMockTurnPrompt,
  buildMockWrapUpPrompt,
  parseMockTurn,
  parseMockWrapUp,
} from './mock.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K',
  requirements: '熟悉 Java、K8s，3-5 年经验',
};

const resume = '# 张三\n- 5 年 Java 后端\n- 订单系统重构';

describe('buildMockTurnPrompt', () => {
  it('sets up a 1:1 interview for the JD', () => {
    const p = buildMockTurnPrompt(jd, resume, [], 1);
    expect(p).toContain('模拟面试');
    expect(p).toContain('高级后端工程师');
    expect(p).toContain('订单系统重构');
    expect(p).toContain('nextQuestion');
  });

  it('marks the first question when history is empty', () => {
    expect(buildMockTurnPrompt(jd, resume, [], 1)).toContain('（这是第一个问题）');
  });

  it('feeds prior turns in interview order', () => {
    const p = buildMockTurnPrompt(jd, resume, [
      { speaker: 'ai', content: '介绍下你做过最难的项目' },
      { speaker: 'user', content: '订单系统重构……' },
    ], 2);
    expect(p).toContain('[面试官] 介绍下你做过最难的项目');
    expect(p).toContain('[求职者] 订单系统重构……');
    expect(p).not.toContain('（这是第一个问题）');
  });
});

describe('parseMockTurn', () => {
  it('parses a valid turn object', () => {
    expect(parseMockTurn('{"feedback": "结构清晰", "nextQuestion": "那QPS多少？"}')).toEqual({
      feedback: '结构清晰',
      nextQuestion: '那QPS多少？',
    });
  });

  it('omits feedback when absent (first turn)', () => {
    expect(parseMockTurn('{"nextQuestion": "先介绍下自己"}').feedback).toBeUndefined();
  });

  it('throws when nextQuestion is missing', () => {
    expect(() => parseMockTurn('{"feedback": "嗯"}')).toThrow();
    expect(() => parseMockTurn('不是 JSON')).toThrow();
  });
});

describe('parseMockWrapUp', () => {
  it('parses feedback + suggestions', () => {
    const r = parseMockWrapUp('{"feedback": "整体不错", "suggestions": ["补量化", "深挖消息队列"]}');
    expect(r.feedback).toBe('整体不错');
    expect(r.suggestions).toEqual(['补量化', '深挖消息队列']);
  });

  it('defaults empty suggestions and missing feedback', () => {
    const r = parseMockWrapUp('{"feedback": ""}');
    expect(r.suggestions).toEqual([]);
    expect(r.feedback).toBeTruthy();
  });
});
