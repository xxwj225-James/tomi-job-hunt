/**
 * HR screening orchestration — pure mapping + batch runner. The LLM verdict is
 * a secondary chip; the decision is the deterministic score→verdict map below
 * (an LLM error renders "未评分", never auto-婉拒).
 */
import { hrMatch } from './prompt.js';
import type { HrLlmConfig } from './llm.js';

export type HrVerdict = '约面' | '待定' | '婉拒';

/** Decision thresholds: >=80 约面 / 60-79 待定 / <60 婉拒. */
export function scoreToHrVerdict(score: number): HrVerdict {
  if (score >= 80) return '约面';
  if (score >= 60) return '待定';
  return '婉拒';
}

export interface HrJd {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
}

/** Heuristic fill from pasted JD text — manual field overrides win in the UI. */
export function jdFromText(raw: string): HrJd {
  const text = raw.trim();
  const pick = (re: RegExp): string => {
    const m = re.exec(text);
    return m?.[1]?.trim() ?? '';
  };
  const firstLine = text.split('\n').find((l) => l.trim())?.trim().slice(0, 30) ?? '';
  const title =
    pick(/岗位[:：]\s*([^\n，。;；]+)/) ||
    pick(/职位[:：]\s*([^\n，。;；]+)/) ||
    pick(/招聘[:：]\s*([^\n，。;；]+)/) ||
    firstLine;
  const company =
    pick(/公司[:：]\s*([^\n，。;；]+)/) ||
    pick(/公司名称[:：]\s*([^\n，。;；]+)/) ||
    pick(/企业[:：]\s*([^\n，。;；]+)/) ||
    '';
  const salaryText =
    pick(/(\d+(?:\.\d+)?\s*[-~—至到]\s*\d+(?:\.\d+)?\s*[Kk万])/) ||
    pick(/薪资[:：]\s*([^\n。]+)/) ||
    '';
  return { title, company, salaryText, requirements: text };
}

/** Candidate display name from the file name (e.g. "简历-张三.pdf" → "张三"). */
export function candidateNameFromFile(name: string): string {
  let base = name.replace(/\.(pdf|docx|txt|md|doc)$/i, '');
  base = base.replace(/^(简历|resume|cv)[-_]*/i, '');
  base = base.replace(/[-_]*resume[-_]*$/i, '');
  base = base.replace(/[-_]+/g, ' ');
  return base.trim() || '未命名候选人';
}

export interface ScreenOutcome {
  name: string;
  score: number | null; // null = LLM error → "未评分"
  verdict: HrVerdict | null;
  verdictLabel?: string; // LLM-authored chip (强烈推荐/推荐/…)
  strengths: string[];
  gaps: string[];
  risks: string[];
  error?: string;
  ms: number;
}

export interface ScreenCandidate {
  name: string;
  text: string;
}

/** One candidate, one LLM call with a single retry on failure (mirrors core scoreJd). */
export async function screenCandidate(
  cfg: HrLlmConfig,
  jd: HrJd,
  candidate: ScreenCandidate,
): Promise<ScreenOutcome> {
  const t0 = Date.now();
  try {
    let result;
    try {
      result = await hrMatch(cfg, jd, candidate.text);
    } catch (err) {
      // one retry — transient network/parse failures are common
      result = await hrMatch(cfg, jd, candidate.text);
    }
    return {
      name: candidate.name,
      score: result.score,
      verdict: scoreToHrVerdict(result.score),
      verdictLabel: result.verdict,
      strengths: result.strengths,
      gaps: result.gaps,
      risks: result.risks,
      ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      name: candidate.name,
      score: null,
      verdict: null,
      strengths: [],
      gaps: [],
      risks: [],
      error: (err as Error).message,
      ms: Date.now() - t0,
    };
  }
}

/** Batched screening with a bounded concurrency pool (default 4 LLM calls in flight). */
export async function screenBatch(
  cfg: HrLlmConfig,
  jd: HrJd,
  candidates: ScreenCandidate[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<ScreenOutcome[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const outcomes = new Array<ScreenOutcome>(candidates.length);
  let done = 0;
  const total = candidates.length;

  let next = 0;
  const runner = async (): Promise<void> => {
    while (next < total) {
      const i = next;
      next += 1;
      outcomes[i] = await screenCandidate(cfg, jd, candidates[i]!);
      done += 1;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => runner()));

  return outcomes
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const sa = a.o.score ?? -1;
      const sb = b.o.score ?? -1;
      return sb - sa;
    })
    .map(({ o }) => o);
}
