import { describe, expect, it } from 'vitest';
import { buildGreetingPrompt } from './greeting.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K·14薪',
  requirements: '熟悉 Java、Redis、K8s，3-5 年经验',
  hrName: '张HR',
};

describe('buildGreetingPrompt', () => {
  it('includes JD hard requirements and resume evidence', () => {
    const resume = '# 张三\n- 5 年 Java，主导过订单系统\n';
    const prompt = buildGreetingPrompt(jd, resume);
    expect(prompt).toContain('高级后端工程师');
    expect(prompt).toContain('熟悉 Java、Redis、K8s');
    expect(prompt).toContain('张三');
    expect(prompt).toContain('订单系统');
  });

  it('notes when resume is missing', () => {
    const prompt = buildGreetingPrompt(jd);
    expect(prompt).toContain('未配置简历');
  });

  it('appends regeneration feedback as a strict requirement', () => {
    const prompt = buildGreetingPrompt(jd, 'resume', '语气更简洁，突出 K8s 经验');
    expect(prompt).toContain('修改意见');
    expect(prompt).toContain('语气更简洁，突出 K8s 经验');
    // without feedback, no such section
    expect(buildGreetingPrompt(jd, 'resume')).not.toContain('修改意见');
  });

  it('constrains output to the pitch itself', () => {
    const prompt = buildGreetingPrompt(jd, 'resume');
    expect(prompt).toContain('只输出打招呼语本身');
    expect(prompt).toContain('80~120 字');
  });
});
