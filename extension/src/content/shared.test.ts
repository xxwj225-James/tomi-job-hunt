// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { fillChatBox, pickLongText, pickText, stripHidden } from './shared.js';

function installDom(html: string): { doc: Document; win: Window & typeof globalThis } {
  const dom = new JSDOM(html, { url: 'https://www.zhipin.com/job_detail/test.html' });
  // Content-script helpers read the global document/window.
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { window?: Window }).window = dom.window;
  return { doc: dom.window.document, win: dom.window };
}

describe('stripHidden + text extraction', () => {
  it('strips inline-hidden interference words from JD text', () => {
    const { doc } = installDom(`
      <html><body>
        <div class="job-sec-text">
          要求熟悉 Java<span style="display:none">外包驻场加班严重</span>，双休
          <span style="visibility:hidden">996</span>
        </div>
      </body></html>`);
    const text = pickText(doc, ['.job-sec-text']);
    expect(text).toBe('要求熟悉 Java，双休');
    expect(text).not.toContain('外包');
    expect(text).not.toContain('996');
  });

  it('strips elements hidden by stylesheet rules', () => {
    const { doc } = installDom(`
      <html><head><style>.ad-word { display: none; }</style></head><body>
        <div class="job-description">真实 JD 内容<span class="ad-word">虚假高薪内推</span>结束</div>
      </body></html>`);
    const text = pickLongText(doc, ['.job-description']);
    expect(text).toBe('真实 JD 内容结束');
  });

  it('does not mutate the live DOM', () => {
    const { doc } = installDom(`
      <html><body><div class="x">正常<span style="display:none">隐藏</span></div></body></html>`);
    pickText(doc, ['.x']);
    expect(doc.querySelector('.x')?.textContent).toBe('正常隐藏');
  });
});

describe('fillChatBox', () => {
  it('fills a contenteditable div and dispatches input events', () => {
    const { doc } = installDom(`
      <html><body><div id="chat-input" class="chat-input" contenteditable="true"></div></body></html>`);
    let inputFired = false;
    doc.querySelector('.chat-input')!.addEventListener('input', () => {
      inputFired = true;
    });
    const filled = fillChatBox('你好，看到贵司岗位', ['#chat-input.chat-input[contenteditable="true"]', '.chat-input']);
    expect(filled).toBe(true);
    expect(doc.querySelector('.chat-input')?.textContent).toBe('你好，看到贵司岗位');
    expect(inputFired).toBe(true);
  });

  it('fills a React-controlled textarea via the native value setter', () => {
    const { doc } = installDom(`<html><body><textarea class="input-area"></textarea></body></html>`);
    const ta = doc.querySelector('textarea')!;
    let inputFired = false;
    ta.addEventListener('input', () => {
      inputFired = true;
    });
    const filled = fillChatBox('文本', ['textarea']);
    expect(filled).toBe(true);
    expect(ta.value).toBe('文本');
    expect(inputFired).toBe(true);
  });

  it('returns false when no candidate element exists', () => {
    const { doc } = installDom(`<html><body></body></html>`);
    expect(fillChatBox('文本', ['.chat-input'])).toBe(false);
  });
});
