import { describe, expect, it } from 'vitest';
import { buildGreetingPrompt, loadResume } from './greeting.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

  it('constrains output to the pitch itself', () => {
    const prompt = buildGreetingPrompt(jd, 'resume');
    expect(prompt).toContain('只输出打招呼语本身');
    expect(prompt).toContain('80~120 字');
  });
});

describe('loadResume', () => {
  it('returns undefined when resume.md is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-resume-'));
    expect(loadResume(dir)).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads and trims resume.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-resume-'));
    writeFileSync(join(dir, 'resume.md'), '\n   # 简历\n  ');
    expect(loadResume(dir)).toBe('# 简历');
    rmSync(dir, { recursive: true, force: true });
  });
});
