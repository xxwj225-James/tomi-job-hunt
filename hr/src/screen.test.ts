import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./llm.js', () => ({
  chat: vi.fn(),
  HrLlmError: class extends Error {},
  presetFor: vi.fn(() => undefined),
  loadConfig: vi.fn(() => null),
  saveConfig: vi.fn(),
}));

import { chat } from './llm.js';
import { candidateNameFromFile, jdFromText, scoreToHrVerdict, screenBatch, screenCandidate } from './screen.js';

const chatMock = vi.mocked(chat);

const JD = { title: '高级后端工程师', company: '某某科技', salaryText: '20-30K', requirements: 'Java 5年，Redis，微服务' };

beforeEach(() => {
  chatMock.mockReset();
});

function jsonText(score: number, verdict: string): string {
  return JSON.stringify({ score, verdict, strengths: ['s'], gaps: ['g'], risks: [] });
}

describe('scoreToHrVerdict', () => {
  it('maps boundaries deterministically', () => {
    expect(scoreToHrVerdict(0)).toBe('婉拒');
    expect(scoreToHrVerdict(59)).toBe('婉拒');
    expect(scoreToHrVerdict(60)).toBe('待定');
    expect(scoreToHrVerdict(79)).toBe('待定');
    expect(scoreToHrVerdict(80)).toBe('约面');
    expect(scoreToHrVerdict(100)).toBe('约面');
  });
});

describe('jdFromText', () => {
  it('extracts title, company and salary band', () => {
    const jd = jdFromText('岗位：高级后端工程师\n公司：某某科技\n薪资：20-30K·14薪\n任职要求：Java，Redis');
    expect(jd.title).toBe('高级后端工程师');
    expect(jd.company).toBe('某某科技');
    expect(jd.salaryText).toContain('20-30K');
    expect(jd.requirements).toContain('Java');
  });

  it('falls back to the first line for the title', () => {
    const jd = jdFromText('高级后端工程师（双休）\n负责订单中心');
    expect(jd.title).toBe('高级后端工程师（双休）');
  });

  it('handles empty input', () => {
    const jd = jdFromText('   ');
    expect(jd.title).toBe('');
    expect(jd.company).toBe('');
    expect(jd.salaryText).toBe('');
    expect(jd.requirements).toBe('');
  });
});

describe('candidateNameFromFile', () => {
  it('strips prefixes and extensions', () => {
    expect(candidateNameFromFile('简历-张三.pdf')).toBe('张三');
    expect(candidateNameFromFile('王五.docx')).toBe('王五');
  });
  it('strips trailing -resume in english names', () => {
    expect(candidateNameFromFile('ZhangSan-Resume.pdf')).toBe('ZhangSan');
  });
  it('falls back for a bare filename', () => {
    expect(candidateNameFromFile('resume.pdf')).toBe('未命名候选人');
  });
});

describe('screenCandidate', () => {
  it('maps score to verdict and keeps LLM chip', async () => {
    chatMock.mockResolvedValue({ text: jsonText(88, '强烈推荐'), model: 'm' });
    const o = await screenCandidate({ provider: 'deepseek', model: 'm', apiKey: 'k' }, JD, {
      name: '张三',
      text: 'Java 5年',
    });
    expect(o.score).toBe(88);
    expect(o.verdict).toBe('约面');
    expect(o.verdictLabel).toBe('强烈推荐');
    expect(o.error).toBeUndefined();
  });

  it('returns 未评分 outcome when the LLM call keeps failing', async () => {
    chatMock.mockRejectedValue(new Error('network'));
    const o = await screenCandidate({ provider: 'deepseek', model: 'm', apiKey: 'k' }, JD, {
      name: '李四',
      text: 'x',
    });
    expect(o.score).toBeNull();
    expect(o.verdict).toBeNull();
    expect(o.error).toContain('network');
  });

  it('retries once after a transient failure', async () => {
    chatMock
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce({ text: jsonText(70, '推荐'), model: 'm' });
    const o = await screenCandidate({ provider: 'deepseek', model: 'm', apiKey: 'k' }, JD, {
      name: '王五',
      text: 'y',
    });
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(o.score).toBe(70);
  });
});

describe('screenBatch', () => {
  it('ranks by score descending with a bounded pool', async () => {
    chatMock.mockImplementation(async (_cfg, _messages) => {
      const calls = chatMock.mock.calls.length;
      // return in original order 50 / 90 / 70 by nth call
      const scores = [50, 90, 70];
      return { text: jsonText(scores[calls - 1]!, '推荐'), model: 'm' };
    });
    const candidates = [
      { name: 'a', text: 'x' },
      { name: 'b', text: 'y' },
      { name: 'c', text: 'z' },
    ];
    const out = await screenBatch({ provider: 'deepseek', model: 'm', apiKey: 'k' }, JD, candidates, {
      concurrency: 2,
    });
    expect(out.map((o) => o.score)).toEqual([90, 70, 50]);
  });

  it('keeps failed candidates at the bottom', async () => {
    chatMock.mockImplementation(async () => ({ text: jsonText(80, '推荐'), model: 'm' }));
    const out = await screenBatch({ provider: 'deepseek', model: 'm', apiKey: 'k' }, JD, [
      { name: 'ok', text: 'x' },
      { name: 'bad', text: 'y' },
    ], { concurrency: 1 });
    expect(out[0]!.name).toBe('ok');
  });
});
