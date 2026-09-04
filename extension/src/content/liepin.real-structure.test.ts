import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractLiepinJd, parseConfig, parseJobPosting, waitForJd } from './liepin.js';

function docFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

// Real-page structure (verified 2026-08-17 against
// https://www.liepin.com/a/79090643.shtml): the current build embeds
// window.$CONFIG + schema.org JobPosting (description contains REAL newlines,
// which break JSON.parse — the extractor must tolerate that) and uses
// .job-apply-content / .job-intro-container instead of the old .title-info h1.
const REAL_LIEPIN_HTML = `<html><head>
<script type="text/javascript">
    var $CONFIG = {
        "jobId": 79090643,
        "compId": 88205,
        "jobKind": "1",
        "compName": "\u67D0\u6DF1\u5733\u8D38\u6613\u8FDB\u51FA\u53E3\u516C\u53F8",
        "jobTitle": "\u7814\u53D1\u603B\u76D1\uFF08\u667A\u80FD\u5BB6\u5C45\uFF09",
        "traceId": {"initial":"gw.98996a7d-170363718"}
    };
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "研发总监（智能家居）",
  "description": "职责：
1.负责智能家居产品研发。
2.带领团队。
任职要求：
1.本科及以上。",
  "datePosted": "2026-08-19"
}
</script>
</head><body>
<section class="job-apply-container">
  <div class="job-apply-content">
    <div class="name-box"><span class="name ellipsis-2">研发总监（智能家居）</span><span class="salary">50-75k·13薪</span></div>
    <div class="job-properties"><span>深圳-龙华区</span><span>10年以上</span><span>统招本科</span></div>
  </div>
  <div class="job-apply-operate">
    <a class="btn-main" data-selector="chat-chat">聊一聊</a>
  </div>
</section>
<section class="job-intro-container">职位介绍 职责：1.负责智能家居产品研发。2.带领团队。任职要求：1.本科及以上。</section>
<section class="recruiter-container">岳先生 当前在线 猎头合伙人</section>
<!-- 猜你喜欢 recommendations below must NOT pollute the main job -->
<div class="love-job-container">
  <div class="job-list-item"><div class="job-detail-company-box"><span class="company-name">云鲸智能</span></div></div>
</div>
</body></html>`;

describe('parseConfig (window.$CONFIG, real 2026 build)', () => {
  it('parses jobTitle + compName even with nested objects (traceId)', () => {
    const doc = docFrom(REAL_LIEPIN_HTML);
    const cfg = parseConfig(doc);
    expect(cfg.jobTitle).toBe('研发总监（智能家居）');
    expect(cfg.compName).toBe('某深圳贸易进出口公司');
  });

  it('returns {} when no $CONFIG exists', () => {
    const doc = docFrom(`<html><body></body></html>`);
    expect(parseConfig(doc)).toEqual({});
  });
});

describe('parseJobPosting (schema.org JSON-LD)', () => {
  it('extracts title + description even when real newlines break JSON.parse', () => {
    const doc = docFrom(REAL_LIEPIN_HTML);
    const jp = parseJobPosting(doc);
    expect(jp.title).toBe('研发总监（智能家居）');
    expect(jp.description).toContain('任职要求');
    expect(jp.description).toContain('本科');
  });

  it('tolerates control characters inside string literals', () => {
    const doc = docFrom(`<html><body><script type="application/ld+json">
      {"@type":"JobPosting","title":"X","description":"line1\u000bline2\u0008line3","x":1}
    </script></body></html>`);
    const jp = parseJobPosting(doc);
    expect(jp.description).toBeDefined();
  });
});

describe('extractLiepinJd on the real (2026) page structure', () => {
  it('prefers $CONFIG/JSON-LD and ignores recommendation-card companies', () => {
    const doc = docFrom(REAL_LIEPIN_HTML);
    const jd = extractLiepinJd(doc);
    expect(jd).not.toBeNull();
    expect(jd!.title).toBe('研发总监（智能家居）');
    // $CONFIG.compName wins over the DOM recommendation card (云鲸智能)
    expect(jd!.company).toBe('某深圳贸易进出口公司');
    expect(jd!.requirements).toContain('本科');
    expect(jd!.salaryText).toBe('50-75k·13薪');
  });

  it('falls back to DOM when no JSON sources exist (page has a company node)', () => {
    const doc = docFrom(`
      <html><body>
        <div class="job-apply-content">
          <span class="name ellipsis-2">后端工程师</span>
          <span class="salary">20-30K</span>
        </div>
        <div class="job-apply-container">
          <span class="company-name">某支付公司</span>
        </div>
        <div class="job-intro-container">负责支付系统，要求熟悉 Java 与 K8s</div>
      </body></html>`);
    const jd = extractLiepinJd(doc);
    expect(jd?.title).toBe('后端工程师');
    expect(jd?.company).toBe('某支付公司');
    expect(jd?.requirements).toContain('K8s');
  });
});

describe('waitForJd', () => {
  it('resolves on the real (2026) structure once present', async () => {
    const dom = new JSDOM(`<html><body></body></html>`);
    const doc = dom.window.document;
    setTimeout(() => {
      doc.body.innerHTML = `<section class="job-apply-container"><div class="job-apply-content">
        <span class="name ellipsis-2">架构师</span></div>
        <span class="company-name">某云公司</span></section>
        <section class="job-intro-container">系统架构设计，云原生</section>`;
    }, 30);
    const jd = await waitForJd(doc, 1500, 20);
    expect(jd?.title).toBe('架构师');
  });
});
