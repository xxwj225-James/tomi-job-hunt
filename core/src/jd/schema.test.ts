import { describe, expect, it } from 'vitest';
import {
  computeJobUid,
  jdCaptureInputSchema,
  jdTagsSchema,
  jobReportInputSchema,
} from './schema.js';

describe('computeJobUid', () => {
  it('is stable and normalized', () => {
    const a = computeJobUid(' 某某科技 ', ' 高级后端 ');
    const b = computeJobUid('某某科技', '高级后端');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('differs for different jobs', () => {
    expect(computeJobUid('A公司', '后端')).not.toBe(computeJobUid('A公司', '前端'));
    expect(computeJobUid('A公司', '后端')).not.toBe(computeJobUid('B公司', '后端'));
  });
});

describe('jdCaptureInputSchema', () => {
  it('accepts minimal valid input with defaults', () => {
    const parsed = jdCaptureInputSchema.safeParse({
      source: 'manual',
      url: 'https://example.com/job',
      title: '后端工程师',
      company: '某某公司',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.salaryText).toBe('');
    expect(parsed.data?.requirements).toBe('');
  });

  it('rejects missing required fields', () => {
    expect(jdCaptureInputSchema.safeParse({ source: 'manual' }).success).toBe(false);
    expect(
      jdCaptureInputSchema.safeParse({
        source: 'github' as never,
        url: '',
        title: 'x',
        company: 'y',
      }).success,
    ).toBe(false);
  });
});

describe('jdTagsSchema', () => {
  it('accepts a full valid tag set', () => {
    const parsed = jdTagsSchema.safeParse({
      techStack: ['java', 'k8s'],
      yearsReq: '3-5',
      degreeReq: '本科',
      workHours: '双休',
      salaryBandK: [20, 30],
      riskFlags: ['outsourcing'],
      remote: false,
      summary: '后端岗位，负责高并发系统',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown enum values and empty summary', () => {
    expect(
      jdTagsSchema.safeParse({ techStack: [], riskFlags: [], summary: 'x', workHours: '996' }).success,
    ).toBe(false);
    expect(jdTagsSchema.safeParse({ techStack: [], riskFlags: [], summary: '' }).success).toBe(false);
  });
});

describe('jobReportInputSchema', () => {
  it('accepts enum type only', () => {
    expect(jobReportInputSchema.safeParse({ type: 'outsourcing' }).success).toBe(true);
    expect(jobReportInputSchema.safeParse({ type: '这家公司太坑了' }).success).toBe(false);
  });

  it('enforces note length limit', () => {
    expect(jobReportInputSchema.safeParse({ type: 'unpaid_ot', note: '字'.repeat(101) }).success).toBe(false);
  });
});
