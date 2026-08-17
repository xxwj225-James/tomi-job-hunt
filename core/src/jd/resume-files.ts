/**
 * Resume loading with file-format support: resume.md / resume.txt are read
 * directly; resume.docx (mammoth) and resume.pdf (pdfjs) are parsed on the
 * machine — nothing leaves the box. Priority: md > txt > docx > pdf.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Logger } from '../logger.js';

async function parseDocx(path: string): Promise<string | undefined> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: readFileSync(path) });
    return value.trim() || undefined;
  } catch (err) {
    return undefined;
  }
}

async function parsePdf(path: string): Promise<string | undefined> {
  try {
    const data = new Uint8Array(readFileSync(path));
    const doc = await getDocument({ data }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (pageText) parts.push(pageText);
    }
    return parts.join('\n\n').trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads the resume from the config dir, supporting .md / .txt / .docx / .pdf.
 * Returns undefined when no resume file exists or parsing fails.
 */
export async function loadResumeFile(configDir: string, log?: Logger): Promise<string | undefined> {
  for (const name of ['resume.md', 'resume.txt']) {
    const path = join(configDir, name);
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8').trim();
      if (text) return text;
    }
  }

  const docxPath = join(configDir, 'resume.docx');
  if (existsSync(docxPath)) {
    const text = await parseDocx(docxPath);
    if (text) return text;
    log?.warn('resume: resume.docx exists but could not be parsed');
  }

  const pdfPath = join(configDir, 'resume.pdf');
  if (existsSync(pdfPath)) {
    const text = await parsePdf(pdfPath);
    if (text) return text;
    log?.warn('resume: resume.pdf exists but could not be parsed (scanned image?)');
  }

  return undefined;
}
