import { describe, expect, it } from 'vitest';
import { buildExtractPrompt, parseBatch } from './extract.js';
import type { RawItem } from './sources.js';

describe('parseBatch', () => {
  it('parses structured jobs from LLM output', () => {
    const jobs = parseBatch(
      '```json\n' +
        JSON.stringify({
          jobs: [
            {
              company: '某AI创业公司',
              role: '大模型应用工程师',
              tech: 'Python, RAG, LangChain',
              location: '远程',
              remote: true,
              contact: 'jobs@example.com',
              link: 'https://news.ycombinator.com/item?id=1',
              note: '月薪 30-50K',
            },
          ],
        }) +
        '\n```',
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.company).toBe('某AI创业公司');
    expect(jobs[0]?.remote).toBe(true);
  });

  it('applies defaults for empty fields', () => {
    const jobs = parseBatch('{"jobs": [{"company": "A", "role": "后端"}]}');
    expect(jobs[0]?.tech).toBe('');
    expect(jobs[0]?.link).toBe('');
  });

  it('rejects jobs without company or role', () => {
    expect(() => parseBatch('{"jobs": [{"company": "A"}]}')).toThrow();
  });

  it('tolerates prose around the JSON but rejects wrong shapes', () => {
    // extractJson is tolerant of surrounding prose (LLM chatter)
    expect(parseBatch('好的，结果如下：{"jobs": [{"company": "A", "role": "B"}]}')).toHaveLength(1);
    expect(() => parseBatch('{"jobs": "不是数组"}')).toThrow();
  });
});

describe('buildExtractPrompt', () => {
  it('includes source items with URLs and rules', () => {
    const items: RawItem[] = [
      { id: 'x', source: 'v2ex', title: '招聘后端', text: '远程 30-50K', url: 'https://v2ex.com/t/1' },
    ];
    const prompt = buildExtractPrompt(items);
    expect(prompt).toContain('招聘后端');
    expect(prompt).toContain('https://v2ex.com/t/1');
    expect(prompt).toContain('不编造');
    expect(prompt).toContain('只输出 JSON');
  });
});
