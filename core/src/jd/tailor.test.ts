import { describe, expect, it } from 'vitest';
import { buildTailorPrompt, mdToHtml } from './tailor.js';

const jd = {
  title: '高级后端工程师',
  company: '某某科技',
  salaryText: '20-30K',
  requirements: '熟悉 Java、K8s',
};

describe('buildTailorPrompt', () => {
  it('includes JD, resume and no-fabrication rule', () => {
    const prompt = buildTailorPrompt(jd, '# 简历\n- Java 5 年');
    expect(prompt).toContain('高级后端工程师');
    expect(prompt).toContain('Java 5 年');
    expect(prompt).toContain('绝不编造');
    expect(prompt).toContain('只输出 Markdown 简历本身');
  });

  it('forbids inventing facts (numbers/dates/companies/skills kept verbatim)', () => {
    const prompt = buildTailorPrompt(jd, '# 简历\n- Java 5 年');
    expect(prompt).toContain('原样保留，不得改动、不得新增');
    expect(prompt).toContain('绝不为了匹配 JD 而编造或臆测');
  });

  it('injects the detected industry into the role line', () => {
    const gameJd = { ...jd, title: '游戏数值策划', requirements: '手游经济系统设计' };
    const prompt = buildTailorPrompt(gameJd, '# 简历\n- 游戏策划 3 年');
    expect(prompt).toContain('游戏行业简历定制专家');
    expect(prompt).toContain('按游戏行业的关键词');
  });
});

describe('mdToHtml', () => {
  it('converts headings, paragraphs and lists', () => {
    const html = mdToHtml('# 张三\n\n## 技能\n\n- Java\n- K8s\n\n三年经验。');
    expect(html).toContain('<h1>张三</h1>');
    expect(html).toContain('<h2>技能</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Java</li>');
    expect(html).toContain('<li>K8s</li>');
    expect(html).toContain('</ul>');
    expect(html).toContain('<p>三年经验。</p>');
  });

  it('renders inline **bold** and `code`', () => {
    const html = mdToHtml('- **Java** 5年\n- 用过 `Redis`');
    expect(html).toContain('<li><strong>Java</strong> 5年</li>');
    expect(html).toContain('<li>用过 <code>Redis</code></li>');
  });

  it('escapes HTML in content', () => {
    const html = mdToHtml('## <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('closes lists before headings', () => {
    const html = mdToHtml('- a\n- b\n\n## 下一节\n\n- c');
    const listStart = html.indexOf('<ul>');
    const listEnd = html.indexOf('</ul>');
    const heading = html.indexOf('<h2>');
    expect(listStart).toBeLessThan(heading);
    expect(listEnd).toBeLessThan(heading);
  });
});
