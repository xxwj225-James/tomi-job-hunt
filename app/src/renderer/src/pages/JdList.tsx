import { useState } from 'react';
import { SOURCE_LABEL, type JdRecord, type SessionInfo } from '../lib/types';
import { fmtClock, fmtDay } from '../lib/markdown';

/** Past this, the "更新于" stamp is amber — the poll/push may have stalled. */
const STALE_MS = 45_000;

interface Props {
  jds: JdRecord[];
  selUid: string | null;
  onSelect: (uid: string) => void;
  searchQ: string;
  onSearch: (q: string) => void;
  sessionFor: (jobUid: string) => SessionInfo | undefined;
  /** Epoch ms of the last successful list load; null before the first one. */
  syncedAt: number | null;
  /** Last load failed — the list on screen may be stale. */
  syncFailed: boolean;
  /** A user-initiated refresh is in flight (spins the button). */
  refreshing: boolean;
  onRefresh: () => void;
  onDelete: (jobUid: string) => void;
}

export function JdList({
  jds,
  selUid,
  onSelect,
  searchQ,
  onSearch,
  sessionFor,
  syncedAt,
  syncFailed,
  refreshing,
  onRefresh,
  onDelete,
}: Props): JSX.Element {
  const q = searchQ.trim().toLowerCase();
  // Two-step delete: hovering a row shows ×, clicking it asks for confirmation
  // inline (a native dialog would steal focus from this always-on-top float).
  const [confirmUid, setConfirmUid] = useState<string | null>(null);
  const visible = q
    ? jds.filter((r) =>
        [r.title, r.company, r.requirements, r.salaryText, r.tags?.summary ?? '', (r.tags?.techStack ?? []).join(' ')]
          .join('\n')
          .toLowerCase()
          .includes(q),
      )
    : jds;

  return (
    <>
      <div className="side-head">
        <div className="row">
          <span className="t">
            JD 库
            <button
              className={`side-refresh${refreshing ? ' spinning' : ''}`}
              onClick={onRefresh}
              disabled={refreshing}
              title="立即刷新 JD 库"
              aria-label="刷新 JD 库"
            >
              ⟳
            </button>
          </span>
          <span className="n">
            {jds.length} 个
            {/* Liveness stamp — a frozen list used to look identical to a live
                one. Red = the last load failed, amber = no update in 45s. */}
            {syncFailed ? (
              <a className="sync bad" onClick={onRefresh} title="无法读取 JD 库（core 可能未就绪），点击重试">
                · ⚠ 未同步
              </a>
            ) : syncedAt ? (
              <a
                className={`sync${Date.now() - syncedAt > STALE_MS ? ' stale' : ''}`}
                onClick={onRefresh}
                title="最近一次同步时间，点击立即刷新"
              >
                · 更新于 {fmtClock(syncedAt)}
              </a>
            ) : null}
          </span>
        </div>
        <input
          className="side-search"
          placeholder="搜索公司 / 岗位 / 技术栈…"
          value={searchQ}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="side-list">
        {jds.length === 0 ? (
          <div className="empty-side">
            JD 库为空。<br />
            浏览岗位时插件会自动收集。
          </div>
        ) : null}
        {jds.length > 0 && visible.length === 0 ? (
          <div className="empty-side">没有匹配「{searchQ}」的 JD。</div>
        ) : null}
        {visible.map((r) => {
          const sess = sessionFor(r.jobUid);
          const on = sess?.status === 'online';
          return (
            <div
              key={r.jobUid}
              className={`jd-item${r.jobUid === selUid ? ' active' : ''}`}
              onClick={() => onSelect(r.jobUid)}
            >
              <div className="row1">
                <span className="jname" title={r.title}>
                  {r.title}
                </span>
                {r.tags?.riskFlags?.length ? (
                  <span className="jscore mut">⚠{r.tags.riskFlags.length}</span>
                ) : null}
                {confirmUid === r.jobUid ? (
                  <span className="del-confirm" onClick={(e) => e.stopPropagation()}>
                    <a
                      className="yes"
                      title="确认从 JD 库删除（以后刷到该岗位会重新入库）"
                      onClick={() => {
                        setConfirmUid(null);
                        onDelete(r.jobUid);
                      }}
                    >
                      删除
                    </a>
                    <a className="no" onClick={() => setConfirmUid(null)}>
                      取消
                    </a>
                  </span>
                ) : (
                  <a
                    className="jdel"
                    title="从 JD 库删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmUid(r.jobUid);
                    }}
                  >
                    ×
                  </a>
                )}
              </div>
              <div className="jsub">
                {r.company} · {r.salaryText || SOURCE_LABEL[r.source]}
              </div>
              <div className="jstate">
                {sess ? (
                  <span className={`tab${on ? ' on' : ' off'}`}>{on ? '● 在线' : '离线'}</span>
                ) : (
                  <span className="tab off">未开聊天</span>
                )}
                <span>{r.tags ? (r.tags.techStack[0] ? r.tags.techStack.slice(0, 2).join('·') : '已标注') : '标注中…'}</span>
                <span style={{ marginLeft: 'auto' }}>{fmtDay(r.capturedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="side-foot">
        <a onClick={() => window.tomi?.openConfigDir()} title="打开简历所在目录">
          简历
        </a>
      </div>
    </>
  );
}
