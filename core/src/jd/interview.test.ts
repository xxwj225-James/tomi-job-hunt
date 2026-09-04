import { describe, expect, it } from 'vitest';
import { buildInterviewPrompt, parseInterviewResponse } from './interview.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K',
  requirements: '熟悉 Java、Redis、K8s',
};

describe('buildInterviewPrompt', () => {
  it('includes JD, resume and question mix rules', () => {
    const prompt = buildInterviewPrompt(jd, '# 简历\n- Java 5 年');
    expect(prompt).toContain('高级后端工程师');
    expect(prompt).toContain('Java 5 年');
    expect(prompt).toContain('技术题 60%');
    expect(prompt).toContain('STAR');
    expect(prompt).toContain('只输出 JSON');
  });

  it('injects the detected industry into the role line', () => {
    const gameJd = { ...jd, title: '游戏服务器开发', requirements: '手游后端，熟悉 Netty' };
    const prompt = buildInterviewPrompt(gameJd, '# 简历\n- Java 5 年');
    expect(prompt).toContain('游戏行业资深面试官');
    expect(prompt).toContain('结合游戏行业的技术栈');
  });
});

describe('parseInterviewResponse', () => {
  it('parses a valid question list', () => {
    const result = parseInterviewResponse(
      '```json\n' +
        JSON.stringify({
          questions: [
            { q: 'Redis 缓存穿透怎么处理？', intent: '缓存设计深度', starHint: 'S: 高并发活动缓存场景…' },
            { q: '讲一次跨部门协作冲突', intent: '沟通能力', starHint: 'T: 需求延期冲突…' },
            { q: 'K8s 滚动更新原理', intent: '容器编排基础', starHint: 'A: 灰度发布实践…' },
          ],
        }) +
        '\n```',
    );
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]?.q).toContain('缓存穿透');
    expect(result.questions[1]?.intent).toBe('沟通能力');
  });

  it('rejects fewer than 3 questions', () => {
    expect(() => parseInterviewResponse('{"questions": [{"q": "a", "intent": "b", "starHint": "c"}]}')).toThrow();
  });

  it('rejects more than 10 questions', () => {
    const qs = Array.from({ length: 11 }, () => ({ q: 'a', intent: 'b', starHint: 'c' }));
    expect(() => parseInterviewResponse(JSON.stringify({ questions: qs }))).toThrow();
  });
});
