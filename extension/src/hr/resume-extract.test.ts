// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { candidateToText, extractHrResumeCandidates, extractHrResumeLiepin } from './resume-extract.js';

/**
 * 合成 fixture —— 结构镜像猎聘「搜索人才」列表页（2026-08-31 用户导出），
 * 数据全部为伪造占位，绝不含真实简历 URL / 会话 token。
 */
const LIST_HTML = `
<ul>
  <li class="resumeCardWrap--XzBkN resume-card-4-hover"
      data-resumeidencode="TEST0001"
      data-resumeurl="https://lpt.liepin.com/cvview/showresumedetail?resIdEncode=TEST0001&amp;sfrom=R_SEARCH&amp;ck_id=ck_test&amp;sk_id=sk_test&amp;fk_id=fk_test&amp;sss=sss_test">
    <label class="ant-lpt-checkbox-wrapper checkboxBox--XzBkN"><span class="ant-lpt-checkbox"><input type="checkbox" value="TEST0001"></span></label>
    <div class="resumeCardContent--XzBkN xpath-resume-card">
      <div class="resumeCard--XzBkN">
        <div class="cardLeft--XzBkN">
          <div class="nest-resume-status"><img class="nest-resume-logo" alt="头像"></div>
          <div class="nest-resume-personal">
            <div class="nest-resume-personal-name"><em>罗**</em></div>
            <div class="nest-resume-personal-detail">
              <span title="42岁" class="personal-detail-age">42岁</span>
              <span title="16年" class="personal-detail-workyears">16年</span>
              <span title="硕士" class="personal-detail-edulevel">硕士</span>
              <span title="北京" class="personal-detail-dq">北京</span>
            </div>
            <div class="nest-resume-personal-expect">
              <em>Android架构师</em>
              <span title="北京  互联网  30-45K·14薪" class="personal-expect-content"><span>北京</span><span>互联网</span><span>30-45K·14薪</span></span>
            </div>
            <div class="nest-resume-personal-skills"><span>Android/小程序/性能优化</span></div>
          </div>
        </div>
        <div class="nest-resume-flex-gap"></div>
        <div class="cardRight--XzBkN">
          <div class="nest-resume-right-item nest-resume-work nest-resume-work-read">
            <div class="nest-resume-work-item">
              <div class="work-item-content">
                <span title="某某科技有限公司" class="work-item-compname">某某科技有限公司</span>
                <span class="work-item-extra"><span title="Android开发工程师">Android开发工程师</span><span title="2025.09-至今(11个月)" class="work-item-content-duration">2025.09-至今(11个月)</span></span>
              </div>
            </div>
          </div>
          <div class="nest-resume-right-item nest-resume-edu nest-resume-edu-read">
            <div class="nest-resume-edu-item">
              <div title="广东工业大学 | 机械电子工程 | 硕士 | 统招 | 2007.09-2010.06(3年)" class="edu-item-content">
                <span class="edu-item-school">广东工业大学</span>
                <span class="edu-item-extra"><span>机械电子工程</span><span>硕士</span><span>统招</span><span class="edu-item-content-duration">2007.09-2010.06(3年)</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </li>
  <li class="resumeCardWrap--AbCde resume-card-4-hover"
      data-resumeidencode="TEST0002"
      data-resumeurl="https://lpt.liepin.com/cvview/showresumedetail?resIdEncode=TEST0002&amp;sfrom=R_SEARCH&amp;ck_id=ck_test2">
    <div class="resumeCardContent--AbCde xpath-resume-card">
      <div class="resumeCard--AbCde">
        <div class="cardLeft--AbCde">
          <div class="nest-resume-personal">
            <div class="nest-resume-personal-name"><em>李**</em></div>
            <div class="nest-resume-personal-detail">
              <span title="28岁" class="personal-detail-age">28岁</span>
              <span title="4年" class="personal-detail-workyears">4年</span>
              <span title="本科" class="personal-detail-edulevel">本科</span>
              <span title="上海" class="personal-detail-dq">上海</span>
            </div>
            <div class="nest-resume-personal-expect">
              <em>前端工程师</em>
              <span title="上海  互联网  20-30K" class="personal-expect-content"><span>上海</span><span>互联网</span><span>20-30K</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </li>
</ul>
`;

function docOf(html: string): Document {
  return new JSDOM(html).window.document;
}

describe('extractHrResumeCandidates (猎聘搜索人才列表页)', () => {
  it('parses every candidate card', () => {
    const cards = extractHrResumeCandidates(docOf(LIST_HTML));
    expect(cards).toHaveLength(2);
  });

  it('reads personal + expect + skills fields', () => {
    const [c] = extractHrResumeCandidates(docOf(LIST_HTML));
    expect(c?.name).toBe('罗**');
    expect(c?.age).toBe('42岁');
    expect(c?.workYears).toBe('16年');
    expect(c?.eduLevel).toBe('硕士');
    expect(c?.location).toBe('北京');
    expect(c?.expectTitle).toBe('Android架构师');
    expect(c?.expectSalary).toBe('北京  互联网  30-45K·14薪');
    expect(c?.skills).toBe('Android/小程序/性能优化');
  });

  it('reads work + education history and the resume id', () => {
    const [c] = extractHrResumeCandidates(docOf(LIST_HTML));
    expect(c?.workHistory).toEqual(['某某科技有限公司 | Android开发工程师 | 2025.09-至今(11个月)']);
    expect(c?.education).toEqual(['广东工业大学 | 机械电子工程 | 硕士 | 统招 | 2007.09-2010.06(3年)']);
    expect(c?.resumeId).toBe('TEST0001');
  });

  it('never leaks session tokens into structured output', () => {
    const [c] = extractHrResumeCandidates(docOf(LIST_HTML));
    const text = candidateToText(c!);
    for (const token of ['ck_id', 'sk_id', 'fk_id', 'sss', 'ck_test', 'sk_test', 'showresumedetail?']) {
      expect(text).not.toContain(token);
    }
  });

  it('handles sparse cards without work/edu sections', () => {
    const [, second] = extractHrResumeCandidates(docOf(LIST_HTML));
    expect(second?.name).toBe('李**');
    expect(second?.workHistory).toEqual([]);
    expect(second?.education).toEqual([]);
  });

  it('returns [] for non-list pages', () => {
    expect(extractHrResumeCandidates(docOf('<html><body><p>hello</p></body></html>'))).toEqual([]);
  });

  it('detail-page text extraction is still a no-op (TODO until DOM provided)', () => {
    expect(extractHrResumeLiepin(docOf(LIST_HTML))).toBe('');
  });
});

describe('candidateToText', () => {
  it('builds a structured one-resume summary', () => {
    const [c] = extractHrResumeCandidates(docOf(LIST_HTML));
    const text = candidateToText(c!);
    expect(text).toContain('候选人：罗**（42岁 · 16年 · 硕士 · 北京）');
    expect(text).toContain('期望岗位：Android架构师');
    expect(text).toContain('期望薪资：北京  互联网  30-45K·14薪');
    expect(text).toContain('技能标签：Android/小程序/性能优化');
    expect(text).toContain('工作经历：\n- 某某科技有限公司 | Android开发工程师 | 2025.09-至今(11个月)');
    expect(text).toContain('教育经历：\n- 广东工业大学 | 机械电子工程 | 硕士 | 统招 | 2007.09-2010.06(3年)');
  });
});
