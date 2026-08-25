// @vitest-environment jsdom
/**
 * REAL-PAGE VERIFICATION: runs the actual liepin content script extractor
 * against the live HTML captured from https://www.liepin.com/a/79090643.shtml
 * (fetched 2026-08-17, no login wall on the raw fetch).
 *
 * Fixture file: scripts/liepin-real.html (captured via scripts/fetch-liepin.mjs)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractLiepinJd, waitForJd } from './liepin.js';

const html = readFileSync(resolve(process.cwd(), '../scripts/liepin-real.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://www.liepin.com/a/79090643.shtml' });
const doc = dom.window.document;

describe('extractLiepinJd on REAL page (a/79090643.shtml)', () => {
  it('extracts the job', () => {
    const jd = extractLiepinJd(doc);
    expect(jd).not.toBeNull();
    expect(jd!.title).toContain('研发总监');
    expect(jd!.requirements.length).toBeGreaterThan(50);
  });

  it('waitForJd resolves quickly (AJAX content present in the raw HTML)', async () => {
    const jd = await waitForJd(doc, 3000, 200);
    expect(jd).not.toBeNull();
  });
});
