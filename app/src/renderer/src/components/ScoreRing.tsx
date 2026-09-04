/** Circular score ring — conic-gradient fill colored by the match score. */
export function ScoreRing({ score }: { score: number }): JSX.Element {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const cls = s >= 70 ? 'good' : s >= 50 ? 'warn' : 'bad';
  return (
    <div className={`ring ${cls}`} style={{ ['--p' as string]: `${s}%` }}>
      <b>{s}</b>
    </div>
  );
}
