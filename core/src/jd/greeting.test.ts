import { describe, expect, it } from 'vitest';
import {
  buildGreetingFromPointsPrompt,
  buildGreetingPointsPrompt,
  buildGreetingPrompt,
  normalizePitch,
  parseGreetingPoints,
  scrubUnsupportedYears,
} from './greeting.js';

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

  it('injects the detected industry into the role line', () => {
    const gameJd = { ...jd, title: '游戏引擎开发', requirements: '熟悉 Unity、Cocos，3 年游戏开发经验' };
    const prompt = buildGreetingPrompt(gameJd, 'resume');
    expect(prompt).toContain('游戏行业的资深猎头专家');
    expect(prompt).toContain('结合游戏行业的人才需求特点');
  });

  it('keeps the generic role when no industry is detected', () => {
    const prompt = buildGreetingPrompt({ ...jd, title: '销售经理', requirements: '负责渠道拓展' });
    expect(prompt).toContain('求职者的招聘沟通助手');
    expect(prompt).not.toContain('资深猎头专家');
  });
});

describe('normalizePitch', () => {
  const under = '您好，我从事 Java 后端 8 年，方便看下我的简历吗？';
  expect(under.length).toBeLessThan(120);

  it('keeps a pitch under the limit untouched', () => {
    expect(normalizePitch(under)).toBe(under);
  });

  it('strips one pair of wrapping quotes before measuring', () => {
    expect(normalizePitch(`“${under}”`)).toBe(under);
    expect(normalizePitch(`「${under}」`)).toBe(under);
  });

  it('truncates a long pitch at the last punctuation, not mid-word', () => {
    const long = `${under}${'很期待与你进一步沟通，'.repeat(10)}`;
    expect(long.length).toBeGreaterThan(120);
    const pitch = normalizePitch(long);
    expect(pitch.length).toBeLessThanOrEqual(120);
    // never ends mid-sentence: the cut char before it is a sentence end or comma
    expect(pitch.endsWith('吗？') || pitch.endsWith('，') || pitch.endsWith('。')).toBe(true);
    // and it is a real prefix of the source (nothing invented)
    expect(long.startsWith(pitch)).toBe(true);
  });

  it('hard-cuts when there is no punctuation at all', () => {
    const noPunct = '非常期待有机会和您详细交流我的工作经验和项目实践'.repeat(5);
    expect(normalizePitch(noPunct)).toBe(noPunct.slice(0, 120));
  });
});

// --- Two-stage greeting: JD-oriented point extraction + Stage-2 prompts ---

const RESUME = '# 张三\n\n## 项目\n- Netflix 投影项目：负责软硬件联调与投影设备调试，参与 MySQL 数据管理\n## 技能\n- Java、MySQL、Spring';

describe('parseGreetingPoints', () => {
  it('parses a valid points object', () => {
    expect(
      parseGreetingPoints('好的 {"points": [{"keyword": "sql", "reframed": "负责软硬件联调与数据信息管理"}]}'),
    ).toEqual([{ keyword: 'sql', reframed: '负责软硬件联调与数据信息管理' }]);
  });

  it('returns [] for empty points', () => {
    expect(parseGreetingPoints('{"points": []}')).toEqual([]);
  });

  it('returns [] on malformed output', () => {
    expect(parseGreetingPoints('sorry no json')).toEqual([]);
    expect(parseGreetingPoints('{"points": "nope"}')).toEqual([]);
  });
});

describe('buildGreetingPointsPrompt (Stage 1)', () => {
  it('feeds JD keywords (techStack) and resume, and instructs domain reframing', () => {
    const p = buildGreetingPointsPrompt(jd, RESUME, { techStack: ['java', 'mysql'], summary: 'IT 信息岗' });
    expect(p).toContain('java、mysql');
    expect(p).toContain(RESUME.slice(0, 50));
    expect(p).toContain('领域定向改写');
    expect(p).toContain('绝对禁止编造');
  });

  it('omits techStack cleanly when no tags provided', () => {
    expect(buildGreetingPointsPrompt(jd, RESUME, null)).toContain('JD 关键词（techStack）：（无）');
  });
});

describe('buildGreetingFromPointsPrompt (Stage 2)', () => {
  it('feeds only the points, never the raw resume or requirements', () => {
    const p = buildGreetingFromPointsPrompt(
      jd,
      [{ keyword: 'mysql', reframed: '负责软硬件联调与数据信息管理，主导系统集成' }],
    );
    expect(p).toContain('mysql：负责软硬件联调与数据信息管理，主导系统集成');
    expect(p).not.toContain('Netflix 投影');
    expect(p).not.toContain('任职要求：');
  });

  it('appends regeneration feedback as a strict requirement', () => {
    const p = buildGreetingFromPointsPrompt(
      jd,
      [{ keyword: 'mysql', reframed: '负责软硬件联调与数据信息管理' }],
      '语气更简洁',
    );
    expect(p).toContain('修改意见');
    expect(p).toContain('语气更简洁');
  });
});

describe('scrubUnsupportedYears', () => {
  it('removes a year claim not present in the resume, keeping the skill', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。', '简历：Java开发，3年经验')).toBe(
      '您好，我有Java开发经验。',
    );
  });

  it('keeps a year claim that IS present in the resume', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。', '简历：Java 5年')).toBe(
      '您好，我有5年Java开发经验。',
    );
  });

  it('is a no-op without a resume (prompt already forbids claims)', () => {
    expect(scrubUnsupportedYears('您好，我有5年Java开发经验。')).toBe('您好，我有5年Java开发经验。');
  });
});
