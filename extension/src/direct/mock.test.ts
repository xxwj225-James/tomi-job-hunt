import { describe, expect, it, vi } from 'vitest';
import {
  buildMockTurnPrompt,
  buildMockWrapUpPrompt,
  directMockInterviewTurn,
  directMockInterviewWrapUp,
  parseMockTurn,
  parseMockWrapUp,
} from './mock.js';

vi.mock('./llm.js', () => ({
  directChat: vi.fn(),
}));

import { directChat } from './llm.js';

const JD = { title: '前端工程师', company: '某某科技', salaryText: '15-25K', requirements: 'Vue/React, 3年经验', hrName: '李女士' };
const RESUME = '# 技能栈\n- Vue 4年、React 2年';

describe('buildMockTurnPrompt', () => {
  it('includes JD, resume and rendered history', () => {
    const history = [
      { speaker: 'ai' as const, content: '先介绍一下你自己？' },
      { speaker: 'user' as const, content: '我做了 5 年前端。' },
    ];
    const p = buildMockTurnPrompt(JD, RESUME, history, 1);
    expect(p).toContain('前端工程师');
    expect(p).toContain('Vue 4年');
    expect(p).toContain('[面试官] 先介绍一下你自己？');
    expect(p).toContain('[求职者] 我做了 5 年前端。');
  });

  it('omits history on the first turn and asks for the first question', () => {
    const p = buildMockTurnPrompt(JD, RESUME, [], 0);
    expect(p).toContain('第一个问题');
    expect(p).not.toContain('[面试官]');
  });
});

describe('buildMockWrapUpPrompt', () => {
  it('asks for overall feedback', () => {
    const p = buildMockWrapUpPrompt(JD, RESUME, []);
    expect(p).toContain('整体评价');
    expect(p).toContain('suggestions');
  });
});

describe('parseMockTurn', () => {
  it('parses a valid turn', () => {
    const r = parseMockTurn('{"feedback":"回答清楚","nextQuestion":"深挖一下你的 Vue 项目"}');
    expect(r.feedback).toBe('回答清楚');
    expect(r.nextQuestion).toBe('深挖一下你的 Vue 项目');
  });

  it('allows missing feedback on the first question', () => {
    const r = parseMockTurn('{"nextQuestion":"请自我介绍"}');
    expect(r.feedback).toBeUndefined();
    expect(r.nextQuestion).toBe('请自我介绍');
  });

  it('throws when nextQuestion is missing', () => {
    expect(() => parseMockTurn('{"feedback":"x"}')).toThrow();
  });

  it('throws on malformed JSON', () => {
    expect(() => parseMockTurn('no json')).toThrow();
  });
});

describe('parseMockWrapUp', () => {
  it('parses a valid wrap-up', () => {
    const r = parseMockWrapUp('{"feedback":"整体不错","suggestions":["多讲量化结果","准备系统设计题"]}');
    expect(r.feedback).toBe('整体不错');
    expect(r.suggestions).toHaveLength(2);
  });

  it('caps suggestions at 5 and falls back gracefully', () => {
    const many = Array.from({ length: 9 }, (_, i) => `s${i}`);
    const r = parseMockWrapUp(JSON.stringify({ feedback: 'ok', suggestions: many }));
    expect(r.suggestions).toHaveLength(5);
    expect(parseMockWrapUp('{}').feedback).toBeTruthy();
  });
});

describe('direct calls', () => {
  it('directMockInterviewTurn sends one message and parses', async () => {
    vi.mocked(directChat).mockResolvedValue({
      text: '{"feedback":"不错","nextQuestion":"追问：这个项目你怎么做的？"}',
      model: 'm',
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    const r = await directMockInterviewTurn(JD, RESUME, [], 0);
    expect(r.nextQuestion).toContain('追问');
    expect(directChat).toHaveBeenCalledTimes(1);
  });

  it('directMockInterviewWrapUp returns suggestions', async () => {
    vi.mocked(directChat).mockResolvedValue({
      text: '{"feedback":"可以","suggestions":["a","b"]}',
      model: 'm',
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    const r = await directMockInterviewWrapUp(JD, RESUME, []);
    expect(r.suggestions).toEqual(['a', 'b']);
  });
});
