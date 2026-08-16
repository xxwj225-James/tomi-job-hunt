import { describe, expect, it } from 'vitest';
import {
  buildColdEmailPrompt,
  buildCompanyListPrompt,
  parseColdEmail,
  parseCompanyList,
} from './reverse.js';

describe('parseCompanyList', () => {
  it('parses a company list with channels', () => {
    const list = parseCompanyList(
      JSON.stringify({
        companies: [
          {
            company: '某智能家居公司',
            domain: 'example.com',
            why: '智能电视业务需要 Android WebView 专家',
            likelyChannels: ['官网招聘页', 'GitHub 组织'],
          },
        ],
      }),
    );
    expect(list.companies).toHaveLength(1);
    expect(list.companies[0]?.likelyChannels).toContain('官网招聘页');
  });

  it('rejects empty lists and fake shapes', () => {
    expect(() => parseCompanyList('{"companies": []}')).toThrow();
    expect(() => parseCompanyList('{"companies": "x"}')).toThrow();
  });

  it('prompt includes skills and no-fabrication rule', () => {
    const prompt = buildCompanyListPrompt(['Smart TV', 'Android WebView'], ['深圳'], 15);
    expect(prompt).toContain('Smart TV');
    expect(prompt).toContain('深圳');
    expect(prompt).toContain('15 家');
    expect(prompt).toContain('不编造公司名');
  });
});

describe('parseColdEmail', () => {
  it('parses subject and body', () => {
    const email = parseColdEmail(
      JSON.stringify({ subject: '5 年后端，想聊聊贵司机会', body: '您好…\n\n期待回复' }),
    );
    expect(email.subject).toContain('后端');
    expect(email.body).toContain('期待回复');
  });

  it('rejects empty body', () => {
    expect(() => parseColdEmail('{"subject": "x", "body": ""}')).toThrow();
  });

  it('prompt includes company, skills and structure rules', () => {
    const prompt = buildColdEmailPrompt('某某科技', ['Java'], '# 简历', '背景');
    expect(prompt).toContain('某某科技');
    expect(prompt).toContain('Java');
    expect(prompt).toContain('150-250 字');
    expect(prompt).toContain('只输出 JSON');
  });
});
