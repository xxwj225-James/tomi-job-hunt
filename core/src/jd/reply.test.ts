import { describe, expect, it } from 'vitest';
import { buildReplyPrompt } from './reply.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K',
  requirements: '熟悉 Java、K8s',
};

describe('buildReplyPrompt', () => {
  it('includes JD, resume, history and the incoming message', () => {
    const prompt = buildReplyPrompt(
      jd,
      '# 简历\n- Java 5 年',
      [
        { speaker: 'hr', content: '你好，看到你投递了' },
        { speaker: 'me', content: '您好' },
      ],
      '方便明天下午面试吗？',
    );
    expect(prompt).toContain('高级后端工程师');
    expect(prompt).toContain('Java 5 年');
    expect(prompt).toContain('[对方] 你好');
    expect(prompt).toContain('方便明天下午面试吗');
    expect(prompt).toContain('只输出回复内容本身');
  });

  it('handles first contact without history', () => {
    const prompt = buildReplyPrompt(jd, undefined, [], '薪资可以聊聊吗');
    expect(prompt).toContain('这是第一次对话');
    expect(prompt).toContain('未提供简历');
  });

  it('injects the detected industry into the role line', () => {
    const gameJd = { ...jd, title: '游戏运营', requirements: '手游活动策划，版本节奏' };
    const prompt = buildReplyPrompt(gameJd, '# 简历\n- 游戏运营 3 年', [{ speaker: 'hr', content: '你好' }], '聊聊？');
    expect(prompt).toContain('游戏行业候选人');
    expect(prompt).toContain('按游戏行业的职场表达习惯');
  });
});
