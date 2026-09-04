import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVerifyPrompt, buildTailorPrompt, directTailorResume, mdToHtml, verifyTailorFacts } from './tailor.js';
import { loadVersions, nextVersionNumber, saveVersion, deleteVersion, markApplied } from './versions.js';

vi.mock('./llm.js', () => ({
  directChat: vi.fn(),
}));

import { directChat } from './llm.js';

const JD = { title: '高级后端工程师', company: '某某科技', salaryText: '20-30K', requirements: 'Java, Redis, K8s', hrName: '王女士' };
const RESUME = '# 求职意向\n- 目标岗位：高级后端工程师\n\n# 技能栈\n- Java 5年';

beforeEach(() => {
  vi.mocked(directChat).mockReset();
});

describe('buildTailorPrompt', () => {
  it('includes JD fields, resume and the rewrite rules', () => {
    const p = buildTailorPrompt(JD, RESUME);
    expect(p).toContain('高级后端工程师');
    expect(p).toContain('某某科技');
    expect(p).toContain('Java 5年');
    expect(p).toContain('重排序');
    expect(p).toContain('动词 + 动作 + 量化结果');
  });

  it('forbids fabricating facts: no invented experiences/results/numbers', () => {
    const p = buildTailorPrompt(JD, RESUME);
    expect(p).toContain('绝不编造');
    expect(p).toContain('原样保留，不得改动、不得新增');
    expect(p).toContain('绝不为了匹配 JD 而编造或臆测');
  });

  it('does not leak hrName into the prompt', () => {
    expect(buildTailorPrompt(JD, RESUME)).not.toContain('王女士');
  });
});

describe('buildVerifyPrompt', () => {
  it('includes both base resume and tailored markdown, and the JSON-array instruction', () => {
    const p = buildVerifyPrompt(RESUME, '## 定制版\n- Java');
    expect(p).toContain(RESUME);
    expect(p).toContain('## 定制版');
    expect(p).toContain('只输出一个 JSON 数组');
  });
});

describe('verifyTailorFacts', () => {
  const result = (text: string) => ({ text, model: 'm', usage: { inputTokens: 5, outputTokens: 5 } });

  it('returns fabricated facts parsed from a JSON array', async () => {
    vi.mocked(directChat).mockResolvedValue(result('["在字节跳动任职3年","负责百万级并发系统"]'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual(['在字节跳动任职3年', '负责百万级并发系统']);
    expect(r.unverified).toBe(false);
  });

  it('tolerates a code fence wrapping the JSON array', async () => {
    vi.mocked(directChat).mockResolvedValue(result('```json\n["某公司背景"]\n```'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual(['某公司背景']);
    expect(r.unverified).toBe(false);
  });

  it('returns an empty clean list for []', async () => {
    vi.mocked(directChat).mockResolvedValue(result('[]'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual([]);
    expect(r.unverified).toBe(false);
  });

  it('marks unverified when the model returns non-JSON', async () => {
    vi.mocked(directChat).mockResolvedValue(result('抱歉，我无法判断。'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual([]);
    expect(r.unverified).toBe(true);
  });

  it('marks unverified when the verifier call throws', async () => {
    vi.mocked(directChat).mockRejectedValue(new Error('API 错误 429'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual([]);
    expect(r.unverified).toBe(true);
  });

  it('dedupes repeated fabricated mentions', async () => {
    vi.mocked(directChat).mockResolvedValue(result('["在字节跳动3年","在字节跳动3年"]'));
    const r = await verifyTailorFacts(RESUME, '# 定制版');
    expect(r.fabricated).toEqual(['在字节跳动3年']);
  });
});

describe('mdToHtml', () => {
  it('renders headings, bold, code and lists', () => {
    const html = mdToHtml('# 张三\n\n## 技能栈\n\n- **Java** 5年\n- `Redis`\n\n三年经验。', '张三');
    expect(html).toContain('<title>张三</title>');
    expect(html).toContain('<h1>张三</h1>');
    expect(html).toContain('<h2>技能栈</h2>');
    expect(html).toContain('<li><strong>Java</strong> 5年</li>');
    expect(html).toContain('<li><code>Redis</code></li>');
    expect(html).toContain('<p>三年经验。</p>');
  });

  it('escapes raw HTML in content', () => {
    const html = mdToHtml('## <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('is print-ready: 保存为 PDF toolbar + @media print hides it', () => {
    const html = mdToHtml('# x');
    expect(html).toContain('保存为 PDF');
    expect(html).toContain('window.print()');
    expect(html).toContain('@media print');
    expect(html).toContain('.toolbar { display: none; }');
  });
});

describe('nextVersionNumber', () => {
  it('starts at 1 for an empty list', () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it('increments per jdKey, ignoring other keys', () => {
    const versions = [
      { id: '1', jdKey: 'a|b', jdTitle: '', company: '', version: 3, markdown: '', createdBy: 'tailor' as const },
      { id: '2', jdKey: 'c|d', jdTitle: '', company: '', version: 7, markdown: '', createdBy: 'tailor' as const },
    ];
    expect(nextVersionNumber(versions, 'a|b')).toBe(4);
  });
});

describe('versions CRUD', () => {
  const store: Record<string, unknown> = {};

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (obj: Record<string, unknown>) => Object.assign(store, obj),
          remove: async (key: string) => {
            delete store[key];
          },
        },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('saveVersion assigns per-jdKey versions and groups by jdKey', async () => {
    const v1 = await saveVersion({ jdKey: 'a|b', jdTitle: 'a', company: 'b', markdown: 'm1', createdBy: 'tailor' });
    const v2 = await saveVersion({ jdKey: 'a|b', jdTitle: 'a', company: 'b', markdown: 'm2', createdBy: 'manual' });
    const other = await saveVersion({ jdKey: 'x|y', jdTitle: 'x', company: 'y', markdown: 'm3', createdBy: 'tailor' });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(other.version).toBe(1);
    expect(await loadVersions()).toHaveLength(3);
  });

  it('update path keeps id and version', async () => {
    const v1 = await saveVersion({ jdKey: 'a|b', jdTitle: 'a', company: 'b', markdown: 'm1', createdBy: 'tailor' });
    const v2 = await saveVersion({ ...v1, markdown: 'm1b', note: '新备注' });
    expect(v2.id).toBe(v1.id);
    expect(v2.version).toBe(1);
    expect(v2.note).toBe('新备注');
    expect(await loadVersions()).toHaveLength(1);
  });

  it('persists verified flag', async () => {
    const v = await saveVersion({ jdKey: 'a|b', jdTitle: 'a', company: 'b', markdown: 'm', createdBy: 'tailor', verified: true });
    expect(v.verified).toBe(true);
    expect((await loadVersions())[0]!.verified).toBe(true);
  });

  it('markApplied sets appliedAt; deleteVersion removes', async () => {
    const v = await saveVersion({ jdKey: 'a|b', jdTitle: 'a', company: 'b', markdown: 'm', createdBy: 'tailor' });
    const applied = await markApplied(v.id, '2026-08-31T00:00:00.000Z');
    expect(applied?.appliedAt).toBe('2026-08-31T00:00:00.000Z');
    await expect(markApplied('nope')).resolves.toBeNull();

    await deleteVersion(v.id);
    expect(await loadVersions()).toHaveLength(0);
  });
});

describe('directTailorResume', () => {
  it('calls directChat and trims the result', async () => {
    vi.mocked(directChat).mockResolvedValue({
      text: '\n\n## 简历定制版\n...\n',
      model: 'm',
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    const out = await directTailorResume(JD, RESUME);
    expect(out).toBe('## 简历定制版\n...');
    expect(directChat).toHaveBeenCalledWith([{ role: 'user', content: expect.stringContaining('简历定制专家') }]);
  });
});
