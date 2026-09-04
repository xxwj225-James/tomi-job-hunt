import { SOURCE_LABEL, type JdRecord } from '../lib/types';
import { Tag } from '../components/Tag';

interface Props {
  jd: JdRecord;
}

/** Static view of one saved JD: header, AI tags, and the raw JD text. */
export function JdDetail({ jd }: Props): JSX.Element {
  const tags = jd.tags;
  const hasTagMeta =
    (tags?.techStack?.length ?? 0) > 0 || Boolean(tags?.yearsReq || tags?.degreeReq || tags?.workHours || tags?.remote);

  return (
    <div className="jd-detail">
      <div className="jd-head">
        <div className="jd-title">{jd.title}</div>
        <div className="jd-company">
          {jd.company}
          <span className="chip t" style={{ marginLeft: 6 }}>
            {SOURCE_LABEL[jd.source]}
          </span>
          {jd.hrName ? (
            <span className="chip" style={{ marginLeft: 4 }}>
              HR：{jd.hrName}
            </span>
          ) : null}
          {jd.salaryText ? (
            <span className="chip ok" style={{ marginLeft: 4 }}>
              {jd.salaryText}
            </span>
          ) : null}
        </div>
        <div className="jd-sub">
          <span>采集于 {new Date(jd.capturedAt).toLocaleString('zh-CN', { hour12: false })}</span>
          {jd.url ? (
            <a className="btn link sm" style={{ marginLeft: 'auto' }} onClick={() => window.tomi?.openExternal(jd.url)}>
              打开原文 ↗
            </a>
          ) : null}
        </div>
      </div>

      <div className="jd-block">
        <div className="section-title">AI 标注</div>
        {tags ? (
          <>
            {tags.summary ? <p className="jd-summary">{tags.summary}</p> : null}
            {hasTagMeta ? (
              <div className="match-tags" style={{ marginTop: 8 }}>
                {tags.yearsReq ? <Tag text={tags.yearsReq} tone="t" /> : null}
                {tags.degreeReq ? <Tag text={tags.degreeReq} /> : null}
                {tags.workHours ? <Tag text={tags.workHours} /> : null}
                {tags.remote ? <Tag text="可远程" tone="ok" /> : null}
                {tags.techStack?.slice(0, 14).map((t) => (
                  <Tag key={t} text={t} tone="t" />
                ))}
              </div>
            ) : null}
            {tags.riskFlags?.length ? (
              <div className="match-tags" style={{ marginTop: 6 }}>
                {tags.riskFlags.map((r) => (
                  <Tag key={r} text={`⚠ ${r}`} tone="r" />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="tl-note">
            该 JD 尚未做 AI 标注——切到「📄 简历匹配」跑一次匹配即可自动补全技术栈 / 风险等标签。
          </div>
        )}
      </div>

      <div className="jd-block jd-orig">
        <div className="section-title">JD 原文</div>
        {jd.requirements.trim() ? (
          <div className="jd-orig-body">{jd.requirements}</div>
        ) : (
          <div className="empty-panel" style={{ padding: '16px 12px' }}>
            <b>无 JD 原文</b>
            <span>该岗位只保存了标题与来源，没有抓取到岗位描述正文。<br />在浏览器打开该岗位详情页可重新自动收集。</span>
          </div>
        )}
      </div>
    </div>
  );
}
