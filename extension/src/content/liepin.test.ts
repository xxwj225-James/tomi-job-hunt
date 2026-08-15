import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractLiepinJd, waitForJd } from './liepin.js';

function docFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('extractLiepinJd', () => {
  it('extracts fields from primary selectors', () => {
    const doc = docFrom(`
      <html><body>
        <div class="title-info"><h1>前端工程师</h1></div>
        <div class="job-item-title">18-25K</div>
        <div class="company-info"><div class="name">某互联网公司</div></div>
        <div class="job-description">负责小程序与 H5 开发，要求 React 三年以上经验</div>
        <div class="recruiter-name">李顾问</div>
      </body></html>`);
    const jd = extractLiepinJd(doc);
    expect(jd?.title).toBe('前端工程师');
    expect(jd?.company).toBe('某互联网公司');
    expect(jd?.salaryText).toBe('18-25K');
    expect(jd?.requirements).toContain('React');
    expect(jd?.hrName).toBe('李顾问');
  });

  it('returns null when essentials are missing', () => {
    const doc = docFrom(`<html><body><div class="job-description">只有 JD</div></body></html>`);
    expect(extractLiepinJd(doc)).toBeNull();
  });
});

describe('waitForJd', () => {
  it('returns null when content never appears (SSR shell case)', async () => {
    const doc = docFrom(`<html><body><div>仅 SSR 外壳</div></body></html>`);
    expect(await waitForJd(doc, 100, 20)).toBeNull();
  });

  it('resolves as soon as content appears', async () => {
    const dom = new JSDOM(`<html><body></body></html>`);
    const doc = dom.window.document;
    // Simulate AJAX injection shortly after load
    setTimeout(() => {
      doc.body.innerHTML = `
        <div class="title-info"><h1>后端工程师</h1></div>
        <div class="job-item-title">20-30K</div>
        <div class="company-info"><div class="name">某公司</div></div>
        <div class="job-description">熟悉 Java</div>`;
    }, 50);
    const jd = await waitForJd(doc, 2000, 25);
    expect(jd?.title).toBe('后端工程师');
  });
});
