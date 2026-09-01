/**
 * 猎聘 HR 端候选人提取 — 基于 2026-08-31 用户导出的「搜索人才」列表页 DOM。
 *
 * 列表页（lpt.liepin.com/search）：候选人卡片列表，每张卡是
 * `<li class="resumeCardWrap--…" data-resumeurl="…">`。CSS-modules 类名尾缀
 * （`--XxYy`）随构建变化，选择器一律用「稳定类名前缀 contains」匹配。
 *
 * 简历详情页（lpt.liepin.com/cvview/showresumedetail）的全文提取仍为 TODO：
 * 用户尚未导出详情页 DOM，待提供后填写（函数已预留，走 panel 的「从页面提取」单卡分支）。
 *
 * 隐私：`data-resumeurl` 含会话 token（ck_id/sk_id/sss 等），绝不进入分析文本或
 * 详情链接——只提取 `resIdEncode` 拼干净链接，token 全部丢弃。
 */
import { pickLongText } from './dom-text.js';

/** 简历详情页的干净链接 —— 仅 resIdEncode，无会话 token。 */
export const LIEPIN_RESUME_DETAIL = 'https://lpt.liepin.com/cvview/showresumedetail';

export interface LiepinCandidate {
  name: string; // 已脱敏（如 罗**）
  age: string;
  workYears: string;
  eduLevel: string;
  location: string;
  expectTitle: string;
  expectSalary: string;
  skills: string;
  workHistory: string[]; // 「公司 | 职位 | 时间」
  education: string[]; // 「学校 | 专业 | 学历 | 时间」
  resumeId: string; // resIdEncode —— 拼详情链接用
}

/** `[class*="stablePrefix"]` —— 免疫 CSS-modules 哈希尾缀。 */
function q(prefix: string): string {
  return `[class*="${prefix}"]`;
}

function pickIn(el: Element, prefix: string): string {
  return el.querySelector(q(prefix))?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function parseCard(li: Element): LiepinCandidate | null {
  const resumeUrl = li.getAttribute('data-resumeurl') ?? '';
  const resumeId = resumeUrl.match(/resIdEncode=([^&]+)/)?.[1] ?? '';

  const work: string[] = [];
  li.querySelectorAll(q('nest-resume-work-item')).forEach((el) => {
    const comp = el.querySelector(q('work-item-compname'))?.textContent?.trim() ?? '';
    const role = el.querySelector(q('work-item-extra'))?.querySelector('span')?.getAttribute('title') ?? '';
    const dur = el.querySelector(q('work-item-content-duration'))?.textContent?.trim() ?? '';
    const row = [comp, role, dur].filter(Boolean).join(' | ');
    if (row) work.push(row);
  });

  const edu: string[] = [];
  li.querySelectorAll(q('nest-resume-edu-item')).forEach((el) => {
    const container = el.querySelector(q('edu-item-content'));
    const full = container?.getAttribute('title')?.trim();
    const school = el.querySelector(q('edu-item-school'))?.textContent?.trim() ?? '';
    const extra =
      container?.querySelector(q('edu-item-extra'))?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const row = full || [school, extra].filter(Boolean).join(' | ');
    if (row) edu.push(row);
  });

  const expectEl = li.querySelector(q('nest-resume-personal-expect'));
  const expContent = expectEl?.querySelector(q('personal-expect-content'));
  const expectSalary =
    expContent?.getAttribute('title')?.trim() ||
    Array.from(expContent?.querySelectorAll(':scope > span') ?? [])
      .map((s) => s.textContent?.trim())
      .filter(Boolean)
      .join(' ');

  const c: LiepinCandidate = {
    name: pickIn(li, 'nest-resume-personal-name'),
    age: pickIn(li, 'personal-detail-age'),
    workYears: pickIn(li, 'personal-detail-workyears'),
    eduLevel: pickIn(li, 'personal-detail-edulevel'),
    location: pickIn(li, 'personal-detail-dq'),
    expectTitle: expectEl?.querySelector('em')?.textContent?.trim() ?? '',
    expectSalary,
    skills: pickIn(li, 'nest-resume-personal-skills'),
    workHistory: work,
    education: edu,
    resumeId,
  };
  if (!c.name && !c.expectTitle && !work.length && !edu.length) return null;
  return c;
}

/** 列表页：提取所有可见候选人卡片。 */
export function extractHrResumeCandidates(doc: Document): LiepinCandidate[] {
  const out: LiepinCandidate[] = [];
  doc.querySelectorAll(q('resumeCardWrap--')).forEach((li) => {
    const c = parseCard(li);
    if (c) out.push(c);
  });
  return out;
}

/** 候选人卡片 → 结构化简历文本（送进 HR 匹配 prompt）。不含 URL / 会话 token。 */
export function candidateToText(c: LiepinCandidate): string {
  const lines = [
    `候选人：${c.name}（${[c.age, c.workYears, c.eduLevel, c.location].filter(Boolean).join(' · ')}）`,
    c.expectTitle ? `期望岗位：${c.expectTitle}` : '',
    c.expectSalary ? `期望薪资：${c.expectSalary}` : '',
    c.skills ? `技能标签：${c.skills}` : '',
    c.workHistory.length ? `工作经历：\n${c.workHistory.map((x) => `- ${x}`).join('\n')}` : '',
    c.education.length ? `教育经历：\n${c.education.map((x) => `- ${x}`).join('\n')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * 猎聘 HR 端**简历详情页**全文提取 —— TODO(platform)：待用户导出
 * `/cvview/showresumedetail` 页面 DOM 后填写选择器。列表页请用
 * `extractHrResumeCandidates`。
 */
export function extractHrResumeLiepin(doc: Document): string {
  return pickLongText(doc, [
    // TODO(platform): 简历详情页选择器，例如 '[class*="resume-detail"]', '[class*="baseInfo"]'
  ]);
}

/**
 * Boss直聘 HR 端候选人简历页全文提取 —— TODO(platform)：待用户提供
 * Boss直聘 HR 端真实页面后填写选择器。当前占位返回 ''（面板会提示手动粘贴）。
 */
export function extractHrResumeZhipin(doc: Document): string {
  return pickLongText(doc, [
    // TODO(platform): 按真实 DOM 填写，例如 '.resume-detail-wrap', '[class*="resume"] .detail-body'
  ]);
}
