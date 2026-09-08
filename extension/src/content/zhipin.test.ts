// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  attachZhipinSpaWatcher,
  extractZhipinJdDom,
  hasDetailMarker,
  jidFromUrl,
  parseWapiDetail,
  type ZhipinJd,
} from './zhipin.js';

function docFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('hasDetailMarker', () => {
  it('detects an opened detail view', () => {
    const dom = new JSDOM('<html><body><div class="job-detail-box"><div class="job-name">后端</div></div></body></html>');
    expect(hasDetailMarker(dom.window.document)).toBe(true);
  });

  it('ignores pure list pages', () => {
    const dom = new JSDOM('<html><body><div class="job-list-box"><div class="job-name">后端</div></div></body></html>');
    expect(hasDetailMarker(dom.window.document)).toBe(false);
  });

  it('counts the 立即沟通 button as a detail marker', () => {
    const dom = new JSDOM('<html><body><a class="op-btn op-btn-chat">立即沟通</a></body></html>');
    expect(hasDetailMarker(dom.window.document)).toBe(true);
  });
});

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

describe('attachZhipinSpaWatcher', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // A BOSS SPA "opened detail" view (in-page, URL unchanged).
  function jobDetail(title: string, company: string, salary = '20-30K'): string {
    return `
      <div class="job-detail-box">
        <div class="job-detail-header">
          <span class="job-name">${title}</span>
          <span class="job-salary">${salary}</span>
          <span class="job-company-name">${company}</span>
        </div>
        <div class="job-detail"><div class="job-sec-text">负责 ${title} 相关研发。</div></div>
      </div>`;
  }

  it('commits a stably-viewed job exactly once (2 consecutive ticks, no repeat)', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = jobDetail('后端工程师', '甲厂');
      const imported: string[] = [];
      const silentImport = vi.fn(async (jd: ZhipinJd) => {
        imported.push(`${jd.company}|${jd.title}`);
      });
      const renderPanel = vi.fn();
      const stop = attachZhipinSpaWatcher({ pollMs: 100, silentImport, renderPanel });

      // 1st tick already ran synchronously → candidate seen once, NOT committed
      expect(silentImport).not.toHaveBeenCalled();
      expect(renderPanel).not.toHaveBeenCalled();

      // 2nd consecutive tick → adopt: silent import + panel render
      await vi.advanceTimersByTimeAsync(100);
      expect(imported).toEqual(['甲厂|后端工程师']);
      expect(silentImport).toHaveBeenCalledTimes(1);
      expect(renderPanel).toHaveBeenCalledTimes(1);

      // staying on the same job keeps re-ticking but never re-imports/re-renders
      await vi.advanceTimersByTimeAsync(500);
      expect(silentImport).toHaveBeenCalledTimes(1);
      expect(renderPanel).toHaveBeenCalledTimes(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores transient SPA flicker (A→B→A never commits because it never gets 2 consecutive ticks)', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = jobDetail('岗位A', '甲厂'); // 1st tick: A × 1
      const silentImport = vi.fn(async () => {});
      const renderPanel = vi.fn();
      const stop = attachZhipinSpaWatcher({ pollMs: 100, silentImport, renderPanel });

      // 2nd tick sees B → candidate resets (B × 1) — A never commits
      document.body.innerHTML = jobDetail('岗位B', '乙厂');
      await vi.advanceTimersByTimeAsync(100);
      expect(silentImport).not.toHaveBeenCalled();
      expect(renderPanel).not.toHaveBeenCalled();

      // 3rd tick sees A again → resets once more (A × 1) — still not consecutive
      document.body.innerHTML = jobDetail('岗位A', '甲厂');
      await vi.advanceTimersByTimeAsync(100);
      expect(silentImport).not.toHaveBeenCalled();
      expect(renderPanel).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('imports each newly-stable job; revisiting an imported job only re-renders the panel', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = jobDetail('岗位A', '甲厂');
      const imported: string[] = [];
      const silentImport = vi.fn(async (jd: ZhipinJd) => {
        imported.push(jd.title);
      });
      const renderPanel = vi.fn();
      const stop = attachZhipinSpaWatcher({ pollMs: 100, silentImport, renderPanel });

      await vi.advanceTimersByTimeAsync(100); // adopt A
      expect(imported).toEqual(['岗位A']);
      expect(renderPanel).toHaveBeenCalledTimes(1);

      // switch to B → committed after its own 2 ticks
      document.body.innerHTML = jobDetail('岗位B', '乙厂');
      await vi.advanceTimersByTimeAsync(200);
      expect(imported).toEqual(['岗位A', '岗位B']);
      expect(renderPanel).toHaveBeenCalledTimes(2);

      // back to A: fresh view (re-render), but NOT re-imported this session
      document.body.innerHTML = jobDetail('岗位A', '甲厂');
      await vi.advanceTimersByTimeAsync(200);
      expect(imported).toEqual(['岗位A', '岗位B']);
      expect(renderPanel).toHaveBeenCalledTimes(3);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never imports on pure list pages (no detail marker)', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div class="job-list-box"><div class="job-name">后端工程师</div></div>';
      const silentImport = vi.fn(async () => {});
      const renderPanel = vi.fn();
      const stop = attachZhipinSpaWatcher({ pollMs: 100, silentImport, renderPanel });
      await vi.advanceTimersByTimeAsync(400);
      expect(silentImport).not.toHaveBeenCalled();
      expect(renderPanel).not.toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
