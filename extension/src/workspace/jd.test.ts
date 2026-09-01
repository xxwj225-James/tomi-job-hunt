import { describe, expect, it } from 'vitest';
import { esc, jdFromText, jdKey } from './jd.js';

describe('jdFromText', () => {
  it('parses 岗位/职位/招聘 title, company and salary band', () => {
    const jd = jdFromText(`岗位：高级前端工程师
公司：某某科技
薪资：20-30K
要求：React 5年`);
    expect(jd.title).toBe('高级前端工程师');
    expect(jd.company).toBe('某某科技');
    expect(jd.salaryText).toBe('20-30K');
    expect(jd.requirements).toContain('React 5年');
  });

  it('accepts 职位 and 招聘 as title markers', () => {
    expect(jdFromText('职位：后端开发\n任职要求：Java').title).toBe('后端开发');
    expect(jdFromText('招聘：产品经理\n要求：需求分析').title).toBe('产品经理');
  });

  it('falls back to the first non-empty line as title', () => {
    const jd = jdFromText('高级测试工程师\n公司：测试公司\n要求：自动化');
    expect(jd.title).toBe('高级测试工程师');
  });

  it('keeps the full text as requirements', () => {
    const text = '岗位：运维\n要求：K8s\n加分：CKA';
    expect(jdFromText(text).requirements).toBe(text);
  });

  it('returns empty fields for unmatched text', () => {
    const jd = jdFromText('随便一段文字\n没有结构');
    expect(jd.title).toBe('随便一段文字'); // first-line fallback
    expect(jd.company).toBe('');
    expect(jd.salaryText).toBe('');
  });

  it('matches 万/k salary bands with various separators', () => {
    expect(jdFromText('薪资：15-20万').salaryText).toBe('15-20万');
    expect(jdFromText('薪资：8k-12k').salaryText).toBe('8k-12k');
    expect(jdFromText('薪资：10~15K').salaryText).toBe('10~15K');
    expect(jdFromText('薪资：30-40k·13薪').salaryText).toBe('30-40k');
  });
});

describe('jdKey', () => {
  it('joins title and company', () => {
    expect(jdKey({ title: '前端', company: '某公司' })).toBe('前端|某公司');
  });
});

describe('esc', () => {
  it('escapes HTML metacharacters', () => {
    expect(esc('<b>&"q"</b>')).toBe('&lt;b&gt;&amp;&quot;q&quot;&lt;/b&gt;');
  });
});
