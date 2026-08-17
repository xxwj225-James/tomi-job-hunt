// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The extension's resume-parser imports the *browser* build of pdfjs-dist,
// which references browser globals (DOMMatrix) and a Vite `?url` worker that
// cannot run under Node/jsdom. Real PDF extraction is covered end-to-end by
// core's resume-files.test.ts with the legacy build; here we mock pdfjs to
// verify the .pdf dispatch + error handling paths.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

// jsdom's File/Blob lack .arrayBuffer()/.text(); add them on the prototype so
// parseResumeFile can read uploads the same way a real browser would.
const fileProto = (globalThis as { File?: typeof File }).File?.prototype as
  | (Blob & { arrayBuffer?: () => Promise<ArrayBuffer>; text?: () => Promise<string> })
  | undefined;
if (fileProto && !fileProto.arrayBuffer) {
  fileProto.arrayBuffer = function arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolvePromise, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolvePromise(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this as Blob);
    });
  };
}
if (fileProto && !fileProto.text) {
  fileProto.text = function text(): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolvePromise(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this as Blob);
    });
  };
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist';
import { parseResumeFile, ResumeParseError } from './resume-parser.js';

// Fixtures live in core/test/fixtures; resolve from the workspace root
// (vitest cwd = extension/), since core/ is outside the extension root and
// import.meta.url gets an /@fs/ prefix there.
function fixture(name: string): File {
  const buf = readFileSync(resolve(process.cwd(), '../core/test/fixtures', name));
  return new File([buf], name);
}

function mockPdfText(pages: string[]): void {
  const getDocument = vi.mocked(pdfjsLib.getDocument);
  // pdfjs getDocument() returns a loading task *synchronously*; its `.promise`
  // property resolves to the document. mockResolvedValueOnce would make the
  // call return a Promise, so `.promise` would be undefined — implement the
  // real shape instead.
  getDocument.mockImplementation(() => ({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (i: number) => ({
        getTextContent: async () => ({
          items: pages[i - 1]!.split(/\s+/).map((str) => ({ str })),
        }),
      }),
    }),
  }) as never);
}

describe('parseResumeFile', () => {
  beforeEach(() => {
    vi.mocked(pdfjsLib.getDocument).mockReset();
  });

  it('passes .txt through as text', async () => {
    const file = new File(['5 年 Java 经验，主导过订单系统'], 'resume.txt');
    expect(await parseResumeFile(file)).toBe('5 年 Java 经验，主导过订单系统');
  });

  it('passes .md through as text', async () => {
    const file = new File(['# 张三\n- 5 年 Java'], 'resume.md');
    expect(await parseResumeFile(file)).toBe('# 张三\n- 5 年 Java');
  });

  it('parses .docx via mammoth', async () => {
    const text = await parseResumeFile(fixture('resume-minimal.docx'));
    expect(text).toContain('张三');
    expect(text).toContain('5年Java经验');
  });

  it('parses .pdf via pdfjs (mocked)', async () => {
    mockPdfText(['Zhang San 5y Java']);
    const text = await parseResumeFile(fixture('resume-minimal.pdf'));
    expect(text).toContain('Zhang San');
    expect(pdfjsLib.getDocument).toHaveBeenCalledOnce();
  });

  it('throws a friendly error when a PDF contains no extractable text', async () => {
    mockPdfText(['']);
    const file = new File([''], 'resume.pdf');
    await expect(parseResumeFile(file)).rejects.toBeInstanceOf(ResumeParseError);
    await expect(parseResumeFile(file)).rejects.toThrow(/PDF/);
  });

  it('throws a friendly error for legacy .doc', async () => {
    const file = new File(['legacy'], 'resume.doc');
    await expect(parseResumeFile(file)).rejects.toBeInstanceOf(ResumeParseError);
    await expect(parseResumeFile(file)).rejects.toThrow(/docx|PDF/);
  });

  it('throws for unsupported extensions', async () => {
    const file = new File(['x'], 'resume.rtf');
    await expect(parseResumeFile(file)).rejects.toBeInstanceOf(ResumeParseError);
  });
});
