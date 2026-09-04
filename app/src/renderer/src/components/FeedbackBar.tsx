import { useState } from 'react';
import { api } from '../lib/api';
import { FEEDBACK_TAGS } from '../lib/types';

interface Props {
  /** 'greeting' | 'match' — what the user is rating. */
  feature: string;
}

/**
 * Result feedback bar — 👍/👎 → (down) complaint chips + note → saved to the
 * core shared bank. Aggregated "personal rules" are merged into subsequent
 * greeting generations at the call site (see ChatPanel). Same semantics as the
 * extension's feedbackBar (extension/src/content/shared.ts), but backed by the
 * core /v1/feedback store instead of chrome.storage.
 */
export function FeedbackBar({ feature }: Props): JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'edit' | 'done'>('idle');
  const [thumbs, setThumbs] = useState<'up' | 'down' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function reset(): void {
    setPhase('idle');
    setThumbs(null);
    setSelected([]);
    setNote('');
    setErr('');
  }

  function pick(t: 'up' | 'down'): void {
    setThumbs(t);
    setErr('');
    setPhase('edit');
  }

  function toggleTag(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save(): Promise<void> {
    if (!thumbs) return;
    setBusy(true);
    setErr('');
    try {
      await api.feedbackAdd({
        feature,
        thumbs,
        tags: selected,
        note: note.trim() || undefined,
      });
      setPhase('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fb-bar">
      {phase === 'idle' ? (
        <>
          <div className="fb-prompt">这个结果怎么样？你的偏好会影响后续生成 👇</div>
          <div className="fb-ops">
            <button className="btn sm" onClick={() => pick('up')} title="认可这条，风格会被记住">
              👍 不错
            </button>
            <button className="btn sm" onClick={() => pick('down')} title="指出问题，下次生成会避开">
              👎 待改进
            </button>
          </div>
        </>
      ) : phase === 'edit' ? (
        <div className="fb-edit">
          {thumbs === 'down' ? (
            <div className="fb-tags">
              {Object.entries(FEEDBACK_TAGS).map(([id, label]) => (
                <button
                  key={id}
                  className={`fb-tag${selected.includes(id) ? ' on' : ''}`}
                  onClick={() => toggleTag(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="fb-upnote">👍 已认可，可补充一句为什么喜欢（可选）</div>
          )}
          <textarea
            className="fb-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={thumbs === 'down' ? '具体想怎么改？例如：结尾太突兀，希望自然一点（可选）' : '补充说明（可选）'}
          />
          <div className="fb-ops">
            <button className="btn sm" onClick={reset}>
              取消
            </button>
            <button className="btn sm primary" disabled={busy} onClick={() => void save()}>
              {busy ? '保存中…' : '保存反馈'}
            </button>
          </div>
        </div>
      ) : (
        <div className="fb-done">
          ✅ 已记录你的偏好，后续生成会参考。
          <button className="btn link sm" onClick={reset}>
            再评一条
          </button>
        </div>
      )}
      {err ? (
        <div className="error-note" style={{ marginTop: 6 }}>
          保存失败：{err}
        </div>
      ) : null}
    </div>
  );
}
