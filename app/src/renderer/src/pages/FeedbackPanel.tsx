import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { fmtDay } from '../lib/markdown';
import type { BoardStatus, BoardView, JdRecord } from '../lib/types';

interface Props {
  jd: JdRecord | null;
}

export const BOARD_STATUSES: BoardStatus[] = ['greeted', 'applied', 'interview', 'offer', 'rejected'];
export const STATUS_LABELS: Record<BoardStatus, string> = {
  greeted: '已打招呼',
  applied: '已投简历',
  interview: '面试中',
  offer: '已 Offer',
  rejected: '已拒绝',
};

export function FeedbackPanel({ jd }: Props): JSX.Element {
  const [view, setView] = useState<BoardView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState({
    status: 'greeted' as BoardStatus,
    company: '',
    title: '',
    url: '',
    note: '',
  });

  useEffect(() => {
    if (jd) {
      setF((prev) => ({ ...prev, company: jd.company, title: jd.title, url: jd.url || '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jd?.jobUid]);

  async function load(): Promise<void> {
    setBusy(true);
    setErr('');
    try {
      setView(await api.board());
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(): Promise<void> {
    if (!f.company.trim() || !f.title.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api.boardAdd({ status: f.status, company: f.company.trim(), title: f.title.trim(), url: f.url.trim(), note: f.note.trim() || undefined });
      setF({ ...f, note: '' });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const entries = view?.entries ?? [];

  return (
    <div>
      <div className="section-title">求职投递看板（~/.tomi-job-hunt/board.md）</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {BOARD_STATUSES.map((s) => {
          const n = view?.counts?.[s] ?? 0;
          return (
            <span key={s} className={`chip${s === 'greeted' ? ' t' : ''}`}>
              {STATUS_LABELS[s]} <b style={{ marginLeft: 4 }}>{n}</b>
            </span>
          );
        })}
      </div>

      <div className="board-add">
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>
          记录投递进度 {jd ? <span className="faint">（已预填当前 JD）</span> : null}
        </div>
        <div className="bf">
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as BoardStatus })}>
            {BOARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <input className="f1" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} placeholder="公司" />
          <input className="f1" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="岗位" />
          <input className="f1" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="备注（可选）" />
          <button className="btn sm primary" disabled={busy || !f.company.trim() || !f.title.trim()} onClick={() => void add()}>
            {busy ? '保存中…' : '＋ 记录'}
          </button>
        </div>
      </div>

      {err ? <div className="error-note">{err}</div> : null}

      {entries.length === 0 ? (
        <div className="empty-panel" style={{ border: '1px dashed var(--border)', borderRadius: 12, marginTop: 12 }}>
          看板为空。发出第一条打招呼或投递后，在这里记录进展。
        </div>
      ) : (
        <div className="kanban-cols">
          {BOARD_STATUSES.map((s) => {
            const rows = entries.filter((e) => e.status === s).sort((a, b) => b.ts.localeCompare(a.ts));
            return (
              <div key={s} className="kcol">
                <div className="kc-head">
                  <span>{STATUS_LABELS[s]}</span>
                  <span className="n">{rows.length}</span>
                </div>
                <div className="kc-list">
                  {rows.map((e, i) => (
                    <div key={i} className="krow">
                      <div className="kt">{e.title}</div>
                      <div className="ks">{e.company}</div>
                      {e.note ? <div className="km">{e.note}</div> : null}
                      <div className="kd">{fmtDay(e.ts)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
