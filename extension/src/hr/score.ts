/**
 * HR verdict — SYNCHRONIZED COPY of `hr/src/screen.ts` `scoreToHrVerdict`.
 * Keep in sync when the threshold changes (both sides note this in headers).
 */

export type HrVerdict = '约面' | '待定' | '婉拒';

/** Deterministic mapping — LLM errors yield null (rendered as 未评分), never auto-reject. */
export function scoreToHrVerdict(score: number): HrVerdict {
  if (score >= 80) return '约面';
  if (score >= 60) return '待定';
  return '婉拒';
}

/** Badge color for a verdict. */
export function hrVerdictColor(verdict: HrVerdict): string {
  switch (verdict) {
    case '约面':
      return '#1a7f37';
    case '待定':
      return '#b25e00';
    case '婉拒':
      return '#c0392b';
  }
}
