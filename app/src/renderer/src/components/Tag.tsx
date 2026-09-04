interface TagProps {
  text: string;
  /** t = tech/accent, r = risk, ok, warn, default(muted). */
  tone?: 't' | 'r' | 'ok' | 'warn';
  title?: string;
}

export function Tag({ text, tone, title }: TagProps): JSX.Element {
  const cls = ['chip', tone ? tone : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title ?? text}>
      {text}
    </span>
  );
}
