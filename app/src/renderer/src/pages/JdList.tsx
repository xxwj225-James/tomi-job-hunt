import { SOURCE_LABEL, type JdRecord, type SessionInfo } from '../lib/types';
import { fmtDay } from '../lib/markdown';

interface Props {
  jds: JdRecord[];
  selUid: string | null;
  onSelect: (uid: string) => void;
  searchQ: string;
  onSearch: (q: string) => void;
  sessionFor: (jobUid: string) => SessionInfo | undefined;
}

export function JdList({ jds, selUid, onSelect, searchQ, onSearch, sessionFor }: Props): JSX.Element {
  const q = searchQ.trim().toLowerCase();
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
          <span className="t">JD 库</span>
          <span className="n">{jds.length} 个</span>
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
