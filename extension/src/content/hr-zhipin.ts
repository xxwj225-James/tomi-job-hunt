/**
 * HR 端（Boss直聘 HR 端候选人简历页）— 挂载 HR 简历分析面板。
 *
 * TODO(platform): 待用户提供真实 HR 端简历页 URL 后：
 *   1. 填 isHrResumePage() 的真实 URL 判定
 *   2. 在 public/manifest.json 注册 content_scripts（含 host_permissions，若 HR 端在子域）
 *   3. 填 extractHrResumeZhipin 的选择器
 * 当前 manifest 未注册本脚本，代码先保证构建通过。
 */
import { mountHrPanel } from '../hr/panel.js';
import { extractHrResumeZhipin } from '../hr/resume-extract.js';
import { analyzeResume } from '../hr/analyze.js';
import { loadHrConfig } from '../hr/config.js';

/** TODO(platform): HR 端简历页 URL 判定，待真实页面确定后填写（如 /web/boss/ 下某路径）。 */
function isHrResumePage(): boolean {
  return /\/web\/boss\//.test(window.location.href);
}

async function main(): Promise<void> {
  if (!isHrResumePage()) return;
  await mountHrPanel({
    extractPageText: () => extractHrResumeZhipin(document),
    copyPageText: async () => {
      const text = document.body?.innerText ?? '';
      await navigator.clipboard.writeText(text.slice(0, 100_000));
    },
    onAnalyze: async (jd, resume) => {
      const cfg = await loadHrConfig();
      if (!cfg) throw new Error('未配置 HR API Key——点面板右上「配置」粘贴后重试。');
      return analyzeResume(cfg, jd, resume);
    },
  });
}

// Auto-run only in the real browser (not in vitest/jsdom imports).
if (typeof document !== 'undefined' && typeof chrome !== 'undefined') void main();
