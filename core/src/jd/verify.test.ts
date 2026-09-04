import { describe, expect, it } from 'vitest';
import { buildVerifyPrompt, parseVerifyResponse } from './verify.js';

const RESUME = '# 张三\n- 某某电商（2021-03 至今）高级后端工程师\n- Java 5年 · K8s';

describe('buildVerifyPrompt', () => {
  it('diffs the tailored markdown against the base resume', () => {
    const p = buildVerifyPrompt(RESUME, '## 项目\n- 主导订单系统重构（Java + K8s）');
    expect(p).toContain('【原简历】');
    expect(p).toContain('【定制版】');
    expect(p).toContain(RESUME.slice(0, 30));
    expect(p).toContain('JSON 数组');
  });
});

describe('parseVerifyResponse', () => {
  it('returns empty when the model reports no fabrication', () => {
    expect(parseVerifyResponse('[]')).toEqual({ fabricated: [], unverified: false });
  });

  it('extracts a JSON array embedded in prose', () => {
    const r = parseVerifyResponse('以下是发现：["新增了 3 年大数据经验", "编造了某某云经历"]');
    expect(r.fabricated).toEqual(['新增了 3 年大数据经验', '编造了某某云经历']);
    expect(r.unverified).toBe(false);
  });

  it('dedupes repeated facts', () => {
    const r = parseVerifyResponse('["重复数字 QPS 5000", "重复数字 QPS 5000"]');
    expect(r.fabricated).toEqual(['重复数字 QPS 5000']);
  });

  it('marks non-array output as unverified (never silently clean)', () => {
    expect(parseVerifyResponse('{"detail":"unexpected"}')).toEqual({ fabricated: [], unverified: true });
  });
});
