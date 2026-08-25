// @vitest-environment jsdom
/** Manual inspection: dump what the extractor pulls from the REAL page. */
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { extractLiepinJd } from './liepin.js';

it('dump extraction from real liepin page', () => {
  const html = readFileSync(resolve(process.cwd(), '../scripts/liepin-real.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://www.liepin.com/a/79090643.shtml' });
  const jd = extractLiepinJd(dom.window.document);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(jd, null, 2));
});
