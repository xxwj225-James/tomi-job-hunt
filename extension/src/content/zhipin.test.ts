import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { extractZhipinJdDom, jidFromUrl, parseWapiDetail } from './zhipin.js';

function docFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('jidFromUrl', () => {
  it('parses job ids from detail URLs', () => {
    expect(jidFromUrl('https://www.zhipin.com/job_detail/abc123.html')).toBe('abc123');
    expect(jidFromUrl('https://www.zhipin.com/job_detail/abc123.html?ka=search_list')).toBe('abc123');
    expect(jidFromUrl('https://www.zhipin.com/web/geek/chat?x=1')).toBeNull();
  });
});

describe('parseWapiDetail', () => {
  it('parses the current zpData.jobDetail shape', () => {
    const jd = parseWapiDetail({
      zpData: {
        jobDetail: {
          jobName: '高级后端工程师',
          salaryDesc: '20-30K·14薪',
          brandName: '某某科技',
          postDescription: '负责高并发订单系统',
          bossName: '张HR',
        },
      },
    });
    expect(jd).toEqual({
      title: '高级后端工程师',
      company: '某某科技',
      salaryText: '20-30K·14薪',
      requirements: '负责高并发订单系统',
      hrName: '张HR',
    });
  });

  it('handles alternate field names', () => {
    const jd = parseWapiDetail({
      zpData: { jobDetail: { title: '工程师', companyName: '公司', jdText: 'JD 文本', salary: '15K' } },
    });
    expect(jd?.title).toBe('工程师');
    expect(jd?.company).toBe('公司');
    expect(jd?.requirements).toBe('JD 文本');
  });

  it('returns null on missing essentials or wrong shape', () => {
    expect(parseWapiDetail({ data: { jobDetail: {} } })).toBeNull();
    expect(parseWapiDetail({ zpData: { jobDetail: { salaryDesc: '20K' } } })).toBeNull();
    expect(parseWapiDetail(null)).toBeNull();
  });
});

describe('extractZhipinJdDom', () => {
  it('extracts from the current (2026) selector set', () => {
    const doc = docFrom(`
      <html><body>
        <div class="job-detail-header">
          <span class="job-name">高级后端工程师</span>
          <span class="job-salary">20-30K·14薪</span>
          <span class="job-company-name">某某科技</span>
        </div>
        <div class="job-detail">
          <div class="job-keyword-list">Java Redis K8s</div>
          <div class="job-sec-text">负责高并发订单系统。要求：熟悉 Java、Redis、K8s</div>
        </div>
        <div class="job-boss-info"><h2 class="name">张HR</h2></div>
      </body></html>`);
    const jd = extractZhipinJdDom(doc);
    expect(jd).toEqual({
      title: '高级后端工程师',
      company: '某某科技',
      salaryText: '20-30K·14薪',
      requirements: '负责高并发订单系统。要求：熟悉 Java、Redis、K8s',
      hrName: '张HR',
    });
  });

  it('falls back to legacy selectors', () => {
    const doc = docFrom(`
      <html><body>
        <div class="job-title">数据工程师</div>
        <div class="salary">15-25K</div>
        <div class="company-info"><div class="name">数据公司</div></div>
        <div class="job-description">熟悉 Spark 与数仓建模</div>
      </body></html>`);
    const jd = extractZhipinJdDom(doc);
    expect(jd?.title).toBe('数据工程师');
    expect(jd?.company).toBe('数据公司');
    expect(jd?.requirements).toBe('熟悉 Spark 与数仓建模');
  });

  it('returns null when title or company is missing', () => {
    const doc = docFrom(`<html><body><div class="job-salary">20K</div></body></html>`);
    expect(extractZhipinJdDom(doc)).toBeNull();
  });
});
