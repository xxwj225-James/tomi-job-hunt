import { useState } from 'react';
import { zhCount } from '../lib/markdown';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRegenerate: () => void;
  /** Refine: optional instruction → regenerate honoring user's request. */
  onRegenerateWith?: (feedback: string) => void;
  busy?: boolean;
}

export function PitchEditor({ value, onChange, onRegenerate, onRegenerateWith, busy }: Props): JSX.Element {
  const [feedback, setFeedback] = useState('');
  const count = zhCount(value);
  const tooShort = count < 70;
  const tooLong = count > 170;
  return (
    <div className="pitch-box">
      <div className="pb-head">
        <span className="section-title" style={{ margin: 0 }}>
          回复话术
        </span>
        <button className="btn sm" onClick={onRegenerate} disabled={busy}>
          {busy ? '生成中…' : '🔄 重新生成'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="生成话术，或直接输入自定义内容…"
      />
      {onRegenerateWith ? (
        <div className="pb-refine">
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="想怎么改？（如：更突出 K8s、语气更随意）"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && feedback.trim()) onRegenerateWith(feedback.trim());
            }}
          />
          <button
            className="btn sm"
            disabled={busy || !feedback.trim()}
            onClick={() => feedback.trim() && onRegenerateWith(feedback.trim())}
          >
            按意见改
          </button>
        </div>
      ) : null}
      <div className="pb-foot">
        <span className={`count${tooShort || tooLong ? ' warn' : ''}`}>{count} 字</span>
        <span className="chip t">目标 80–120 字 · 可编辑</span>
      </div>
    </div>
  );
}
