import { describe, expect, it } from 'vitest';
import { buildSharedIntel, sanitizePii, sanitizeReportNote } from './sanitize.js';
import type { JdRecord, JobReport } from './schema.js';

describe('sanitizePii', () => {
  it('masks CN mobile numbers', () => {
    expect(sanitizePii('联系我 13812345678 谢谢')).toBe('联系我 [已屏蔽] 谢谢');
  });

  it('masks emails', () => {
    expect(sanitizePii('邮箱 hr@example.com 欢迎投递')).toBe('邮箱 [已屏蔽] 欢迎投递');
  });

  it('masks WeChat ids but keeps the label', () => {
    expect(sanitizePii('加我微信：zhangsan_88 详聊')).toBe('加我微信: [已屏蔽] 详聊');
    expect(sanitizePii('VX abcdef123456')).toBe('VX: [已屏蔽]');
  });

  it('masks landline numbers', () => {
    expect(sanitizePii('电话 0755-12345678 转 800')).toBe('电话 [已屏蔽] 转 800');
  });

  it('leaves ordinary text untouched', () => {
    const text = '岗位要求熟悉 React 和 Node.js，三年经验';
    expect(sanitizePii(text)).toBe(text);
  });
});

describe('sanitizeReportNote', () => {
  it('neutralizes abusive language', () => {
    expect(sanitizeReportNote('这垃圾公司就是个骗子')).toBe('该公司口碑存在争议就是个招聘信息与实际情况不符');
  });

  it('truncates to 100 chars', () => {
    const long = '字'.repeat(200);
    expect(sanitizeReportNote(long)).toHaveLength(100);
  });

  it('combines PII masking and neutralization', () => {
    expect(sanitizeReportNote('HR 电话 13900001111，千万别去')).toBe(
      'HR 电话 [已屏蔽]，建议谨慎考虑',
    );
  });
});

describe('buildSharedIntel', () => {
  const record: JdRecord = {
    jobUid: 'abc123',
    source: 'zhipin',
    url: 'https://www.zhipin.com/job_detail/secret.html',
    title: '高级后端工程师',
    company: '某公司',
    salaryText: '20-30K',
    requirements: '原始 JD 全文，包含敏感信息',
    hrName: '张HR',
    capturedAt: '2026-08-15T00:00:00.000Z',
    tags: {
      techStack: ['java'],
      riskFlags: [],
      summary: '后端岗位',
    },
  };
  const reports: JobReport[] = [{ type: 'salary_mismatch', ts: '2026-08-15T00:00:00.000Z' }];

  it('excludes raw JD text, HR name and URL by construction', () => {
    const intel = buildSharedIntel(record, reports);
    expect(intel).toEqual({
      jobUid: 'abc123',
      source: 'zhipin',
      capturedAt: '2026-08-15T00:00:00.000Z',
      tags: record.tags,
      reports,
    });
    expect(JSON.stringify(intel)).not.toContain('requirements');
    expect(JSON.stringify(intel)).not.toContain('hrName');
    expect(JSON.stringify(intel)).not.toContain('url');
    expect(JSON.stringify(intel)).not.toContain('原始 JD');
  });
});
