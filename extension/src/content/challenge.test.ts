// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { isChallengePage, resetChallengePanel, showChallengePanel } from './challenge.js';

function docFrom(html: string, url = 'https://www.zhipin.com/web/geek/jobs'): Document {
  return new JSDOM(html, { url }).window.document;
}

function panelText(): string {
  const host = document.getElementById('tomihunt-panel-host');
  return host?.shadowRoot?.querySelector('#tomi-panel')?.textContent ?? '';
}

// NOTE: no panel-host cleanup between tests — shared.ts keeps the host/shadow
// in module state, so removing the node from the document would leave the
// module writing into a detached tree.
beforeEach(() => {
  resetChallengePanel();
});

describe('isChallengePage', () => {
  it('detects the verification URL', () => {
    expect(isChallengePage(docFrom('<body></body>', 'https://www.zhipin.com/web/common/security-check.html'))).toBe(
      true,
    );
  });

  it('detects the slider widget', () => {
    expect(isChallengePage(docFrom('<body><div class="geetest_holder"></div></body>'))).toBe(true);
  });

  it('detects the wall copy', () => {
    expect(isChallengePage(docFrom('<body><p>请完成安全验证后继续访问</p></body>'))).toBe(true);
  });

  it('detects an access-rate warning', () => {
    expect(isChallengePage(docFrom('<body><p>您的访问过于频繁，请稍后再试</p></body>'))).toBe(true);
  });

  it('does not fire on a normal job page', () => {
    const doc = docFrom(`
      <body>
        <div class="job-detail-box">
          <h1 class="job-name">高级后端工程师</h1>
          <div class="company-name">某某科技</div>
          <a class="op-btn op-btn-chat">立即沟通</a>
          <p>职位描述：负责账号安全相关业务的后端开发。</p>
        </div>
      </body>`);
    expect(isChallengePage(doc)).toBe(false);
  });

  it('does not fire on a list page', () => {
    expect(isChallengePage(docFrom('<body><div class="job-card-wrapper"><span class="job-name">前端</span></div></body>'))).toBe(
      false,
    );
  });
});

describe('showChallengePanel', () => {
  it('explains the cause and offers a refresh', () => {
    showChallengePanel();
    const text = panelText();
    expect(text).toContain('安全验证');
    expect(text).toContain('已暂停采集与入库');
  });

  it('shows once — the 2s poll must not re-pop it every tick', () => {
    showChallengePanel();
    const host = document.getElementById('tomihunt-panel-host')!;
    const panel = host.shadowRoot!.querySelector('#tomi-panel') as HTMLElement;
    panel.textContent = ''; // stand-in for "the user has seen and moved on"

    showChallengePanel();

    expect(panel.textContent).toBe('');
  });
});
