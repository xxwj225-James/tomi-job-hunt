/**
 * HR 端（猎聘企业端 lpt.liepin.com）— 挂载 HR 简历分析面板。
 *
 * 2026-08-31 用户提供了猎聘 HR 端岗位预览页（真实 URL 含账号数据，不入库）。
 * 当前以 HR 门户子域宽匹配（面板被动，仅浮按钮，无副作用），待真实简历页结构确认后收敛路径。
 */
import { mountHrPanel } from '../hr/panel.js';
import { extractHrResumeCandidates, extractHrResumeLiepin } from '../hr/resume-extract.js';
import { analyzeResume } from '../hr/analyze.js';
import { loadHrConfig } from '../hr/config.js';

/** 猎聘 HR 端门户子域 —— 面板挂载判定（被动工具，挂全站无副作用）。 */
function isHrResumePage(): boolean {
  return window.location.hostname === 'lpt.liepin.com';
}

async function main(): Promise<void> {
  if (!isHrResumePage()) return;
  await mountHrPanel({
    extractPageText: () => extractHrResumeLiepin(document),
    extractCandidates: () => extractHrResumeCandidates(document),
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
