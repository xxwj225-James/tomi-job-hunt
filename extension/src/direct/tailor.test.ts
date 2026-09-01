import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTailorPrompt, directTailorResume } from './tailor.js';
import { loadVersions, nextVersionNumber, saveVersion, deleteVersion, markApplied } from './versions.js';

vi.mock('./llm.js', () => ({
  directChat: vi.fn(),
}));

import { directChat } from './llm.js';

const JD = { title: '高级后端工程师', company: '某某科技', salaryText: '20-30K', requirements: 'Java, Redis, K8s', hrName: '王女士' };
const RESUME = '# 求职意向\n- 目标岗位：高级后端工程师\n\n# 技能栈\n- Java 5年';

describe('buildTailorPrompt', () => {
  it('includes JD fields, resume and the 6 rewrite rules', () => {
    const p = buildTailorPrompt(JD, RESUME);
    expect(p).toContain('高级后端工程师');
    expect(p).toContain('某某科技');
    expect(p).toContain('Java 5年');
    expect(p).toContain('重排序');
    expect(p).toContain('绝不编造');
    expect(p).toContain('动词 + 动作 + 量化结果');
  });

  it('does not leak hrName into the prompt', () => {
    expect(buildTailorPrompt(JD, RESUME)).not.toContain('王女士');
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
