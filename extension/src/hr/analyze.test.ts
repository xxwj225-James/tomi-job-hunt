import { describe, expect, it, vi } from 'vitest';
import { analyzeResume } from './analyze.js';
import { scoreToHrVerdict } from './score.js';

vi.mock('../direct/llm.js', () => ({
  directChatWith: vi.fn(),
}));

import { directChatWith } from '../direct/llm.js';

const CFG = { provider: 'deepseek' as const, model: 'deepseek-v4-flash', apiKey: 'sk-test' };
const JD = { title: '高级后端工程师', company: '某某科技', salaryText: '30-40k', requirements: 'Java, Redis, K8s' };
const RESUME = '张三\n8 年 Java 后端经验，熟悉 Redis、K8s';

describe('scoreToHrVerdict', () => {
  it('maps thresholds deterministically', () => {
    expect(scoreToHrVerdict(80)).toBe('约面');
    expect(scoreToHrVerdict(90)).toBe('约面');
    expect(scoreToHrVerdict(79)).toBe('待定');
    expect(scoreToHrVerdict(60)).toBe('待定');
    expect(scoreToHrVerdict(59)).toBe('婉拒');
    expect(scoreToHrVerdict(0)).toBe('婉拒');
  });
});

describe('analyzeResume', () => {
  it('calls directChatWith with the HR-view prompt and maps the result', async () => {
    vi.mocked(directChatWith).mockResolvedValue({
      text: '{"score": 88, "verdict": "强烈推荐", "strengths": ["Java 8年"], "gaps": ["无 K8s 证书"], "risks": []}',
      model: 'm',
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    const r = await analyzeResume(CFG, JD, RESUME);
    expect(r.score).toBe(88);
    expect(r.verdict).toBe('约面');
    expect(r.strengths).toEqual(['Java 8年']);
    expect(r.gaps).toEqual(['无 K8s 证书']);
    expect(r.risks).toEqual([]);
    expect(directChatWith).toHaveBeenCalledWith(
      CFG,
      [{ role: 'user', content: expect.stringContaining('资深招聘顾问') }],
    );
  });

  it('clamps out-of-range scores', async () => {
    vi.mocked(directChatWith).mockResolvedValue({
      text: '{"score": 150}',
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const r = await analyzeResume(CFG, JD, RESUME);
    expect(r.score).toBe(100);
  });
});
