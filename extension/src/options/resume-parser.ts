/**
 * In-browser resume file parsing — everything happens locally, nothing is
 * uploaded. Supports PDF (pdfjs), Word .docx (mammoth), and plain text
 * (.txt / .md). Legacy .doc is not parseable in-browser without server-side
 * conversion — the user is asked to export to PDF/docx or paste text.
 */
import * as pdfjsLib from 'pdfjs-dist';
// Vite emits the worker as an asset; the options page loads it locally.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export class ResumeParseError extends Error {}

export async function parseResumeFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return parsePdf(file);
  if (name.endsWith('.docx')) return parseDocx(file);
  if (name.endsWith('.txt') || name.endsWith('.md')) return file.text();
  if (name.endsWith('.doc')) {
    throw new ResumeParseError(
      '旧版 .doc 格式无法在浏览器解析。请用 Word 另存为 .docx，或导出为 PDF / 直接粘贴文本。',
    );
  }
  throw new ResumeParseError('不支持的简历文件格式。支持: PDF / .docx / .txt / .md');
}

async function parsePdf(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data }).promise;
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
  const text = parts.join('\n\n').trim();
  if (!text) throw new ResumeParseError('PDF 未提取到文本（可能是扫描件图片）。请直接粘贴简历文本。');
  return text;
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // mammoth's openZip only accepts { path | buffer | file } — an ArrayBuffer
  // must be wrapped as `buffer` (JSZip.loadAsync accepts Uint8Array).
  const result = await mammoth.extractRawText({ buffer: new Uint8Array(arrayBuffer) });
  const text = result.value.trim();
  if (!text) throw new ResumeParseError('Word 文档未提取到文本，请直接粘贴简历文本。');
  return text;
}
