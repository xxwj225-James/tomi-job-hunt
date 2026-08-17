import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadResumeFile } from './resume-files.js';

const FIXTURES = fileURLToPath(new URL('../../test/fixtures', import.meta.url));

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'tomi-resume-'));
}

describe('loadResumeFile', () => {
  it('returns undefined when no resume file exists', async () => {
    const dir = tempDir();
    try {
      expect(await loadResumeFile(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads and trims resume.md', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'resume.md'), '\n   # 简历\n  ');
      expect(await loadResumeFile(dir)).toBe('# 简历');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads resume.txt as fallback', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'resume.txt'), '5 年 Java 经验，主导过订单系统\n');
      expect(await loadResumeFile(dir)).toBe('5 年 Java 经验，主导过订单系统');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses resume.docx via mammoth', async () => {
    const dir = tempDir();
    try {
      copyFileSync(join(FIXTURES, 'resume-minimal.docx'), join(dir, 'resume.docx'));
      const text = await loadResumeFile(dir);
      expect(text).toContain('张三');
      expect(text).toContain('5年Java经验');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses resume.pdf via pdfjs', async () => {
    const dir = tempDir();
    try {
      copyFileSync(join(FIXTURES, 'resume-minimal.pdf'), join(dir, 'resume.pdf'));
      const text = await loadResumeFile(dir);
      expect(text).toContain('Zhang San');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers md over txt/docx/pdf', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'resume.md'), '# markdown 简历');
      writeFileSync(join(dir, 'resume.txt'), 'txt 简历');
      copyFileSync(join(FIXTURES, 'resume-minimal.docx'), join(dir, 'resume.docx'));
      copyFileSync(join(FIXTURES, 'resume-minimal.pdf'), join(dir, 'resume.pdf'));
      expect(await loadResumeFile(dir)).toBe('# markdown 简历');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when the pdf cannot be parsed', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'resume.pdf'), 'not a pdf at all');
      expect(await loadResumeFile(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined when the docx cannot be parsed', async () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, 'resume.docx'), 'not a zip');
      expect(await loadResumeFile(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
