import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { toJdParams, type JdRecord, type MatchResult } from '../lib/types';
import { ScoreRing } from '../components/ScoreRing';
import { Tag } from '../components/Tag';
import { FeedbackBar } from '../components/FeedbackBar';

interface Props {
  jd: JdRecord;
  onGotoChat: () => void;
  onGotoInterview: () => void;
}

const cache = new Map<string, MatchResult>();

export function MatchPanel({ jd, onGotoChat, onGotoInterview }: Props): JSX.Element {
  const uid = jd.jobUid;
  const [result, setResult] = useState<MatchResult | null>(cache.get(uid) ?? null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function run(): Promise<void> {
    setLoading(true);
    setErr('');
    try {
      const res = await api.match(toJdParams(jd));
      cache.set(uid, res);
      setResult(res);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!cache.get(uid)) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const t = jd.tags;

  return (
    <div>
      {result ? (
        <div className="match-head">
          <ScoreRing score={result.score} />
          <div style={{ minWidth: 0 }}>
            <div className="mh-title">
              {jd.title} · {jd.company}
            </div>
            <div className="mh-sub">
              {jd.salaryText || '薪资未标注'}
              {t?.yearsReq ? ` · ${t.yearsReq}` : ''}
              {t?.degreeReq ? ` · ${t.degreeReq}` : ''}
              {t?.workHours && t.workHours !== '未标注' ? ` · ${t.workHours}` : ''} · 与「resume.md」匹配
            </div>
            <div className="match-tags">
              {(t?.techStack ?? []).map((s) => (
                <Tag key={s} text={s} tone="t" />
              ))}
              {t?.riskFlags?.map((s) => (
                <Tag key={s} text={s} tone="r" />
              ))}
              {t?.remote ? <Tag text="远程" tone="ok" /> : null}
              {!t ? <Tag text="JD 尚未打标签（浏览时自动）" /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <span className="loading">
            <span className="spin" />
            正在结合简历评估匹配度（约需十几秒）…
          </span>
        </div>
      ) : null}

      {err ? <div className="error-note">{err}</div> : null}
      {result?.warning ? <div className="warn-note">{result.warning}</div> : null}

      {result ? (
        <>
          <div className="match-cols">
            <div className="match-col good">
              <h5>✓ 优势</h5>
              {result.strengths.length ? (
                <ul>
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  （无明显优势）
                </div>
              )}
            </div>
            <div className="match-col gap">
              <h5>△ 差距</h5>
              {result.gaps.length ? (
                <ul>
                  {result.gaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  （无明显差距）
                </div>
              )}
            </div>
            <div className="match-col risk">
              <h5>! 避坑</h5>
              {result.risks.length ? (
                <ul>
                  {result.risks.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <div className="muted" style={{ fontSize: 12 }}>
                  （未发现明显风险）
                </div>
              )}
            </div>
          </div>
          <div className="match-ops">
            <button className="btn sm primary" onClick={onGotoChat}>
              💬 生成话术并发送
            </button>
            <button className="btn sm" onClick={onGotoInterview}>
              🎤 开始模拟面试
            </button>
            <button className="btn sm" onClick={() => void run()} disabled={loading}>
              🔄 重新评估
            </button>
          </div>
          <div className="match-foot">
            匹配数据来自 JD 库 + 本机简历（resume.md），仅在本地处理。打分参考，具体以沟通为准。
          </div>
          <FeedbackBar feature="match" />
        </>
      ) : null}
    </div>
  );
}
