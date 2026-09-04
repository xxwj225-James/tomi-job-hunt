import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { toJdParams, type InterviewQuestion, type JdRecord, type MockTurnMsg, type MockWrapUp } from '../lib/types';

interface Props {
  jd: JdRecord;
}

type Phase = 'intro' | 'drill' | 'done' | 'prep';

interface Drill {
  history: MockTurnMsg[];
  curQ: string;
  /** Feedback on the last submitted answer; undefined before the first answer. */
  feedback?: string;
  turn: number;
  wrapup?: MockWrapUp;
  busy: boolean;
}

const drillCache = new Map<string, Drill>();
const prepCache = new Map<string, InterviewQuestion[]>();

const emptyDrill: Drill = { history: [], curQ: '', turn: 0, busy: false };

export function InterviewPanel({ jd }: Props): JSX.Element {
  const uid = jd.jobUid;
  const [phase, setPhase] = useState<Phase>(() => (drillCache.has(uid) ? (drillCache.get(uid)!.wrapup ? 'done' : 'drill') : 'intro'));
  const [drill, setDrill] = useState<Drill>(() => drillCache.get(uid) ?? emptyDrill);
  const [prep, setPrep] = useState<InterviewQuestion[] | null>(() => prepCache.get(uid) ?? null);
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    const cached = drillCache.get(uid);
    if (cached) {
      setDrill(cached);
      setPhase(cached.wrapup ? 'done' : 'drill');
    } else {
      setDrill(emptyDrill);
      setPhase('intro');
    }
    setPrep(prepCache.get(uid) ?? null);
    setAnswer('');
    setErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  function save(next: Drill): void {
    drillCache.set(uid, next);
    setDrill(next);
  }

  async function startDrill(): Promise<void> {
    const next: Drill = { history: [], curQ: '', turn: 1, busy: true };
    save(next);
    setPhase('drill');
    setErr('');
    try {
      const r = await api.mockTurn(toJdParams(jd), [], 1);
      const h: MockTurnMsg[] = [{ speaker: 'ai', content: r.nextQuestion }];
      save({ history: h, curQ: r.nextQuestion, turn: 1, busy: false });
    } catch (e) {
      save({ ...next, busy: false });
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(opt: { skip?: boolean } = {}): Promise<void> {
    const userText = (opt.skip ? '（跳过本题）' : answer.trim()) || '（跳过本题）';
    const current = drillCache.get(uid) ?? drill;
    const withAnswer: MockTurnMsg[] = [...current.history, { speaker: 'user', content: userText.slice(0, 1500) }];
    save({ ...current, busy: true });
    setErr('');
    try {
      const r = await api.mockTurn(toJdParams(jd), withAnswer, current.turn + 1);
      const withQ: MockTurnMsg[] = [...withAnswer, { speaker: 'ai', content: r.nextQuestion }];
      save({ history: withQ, curQ: r.nextQuestion, feedback: r.feedback, turn: current.turn + 1, busy: false });
      setAnswer('');
    } catch (e) {
      save({ ...current, busy: false });
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  async function endDrill(): Promise<void> {
    const current = drillCache.get(uid) ?? drill;
    save({ ...current, busy: true });
    setErr('');
    try {
      const wrapup = await api.mockWrapUp(toJdParams(jd), current.history);
      save({ ...current, busy: false, wrapup });
      setPhase('done');
    } catch (e) {
      save({ ...current, busy: false });
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  async function loadPrep(): Promise<void> {
    setErr('');
    try {
      if (!prepCache.get(uid)) {
        const { questions } = await api.interviewPrep(toJdParams(jd));
        prepCache.set(uid, questions);
        setPrep(questions);
      }
      setPhase('prep');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    }
  }

  function reset(): void {
    drillCache.delete(uid);
    prepCache.delete(uid);
    setDrill(emptyDrill);
    setPrep(null);
    setPhase('intro');
    setAnswer('');
    setErr('');
  }

  return (
    <div>
      <div className="iv-head">
        <div className="t">
          🎤 模拟面试 · {jd.title}
          <span className="chip" style={{ marginLeft: 6 }}>{jd.company}</span>
        </div>
        {phase === 'drill' ? <span className="progress">第 {drill.turn} 题</span> : null}
      </div>

      {phase === 'intro' ? (
        <div className="empty-panel" style={{ border: '1px dashed var(--border)', borderRadius: 12, marginTop: 12 }}>
          <b>两种练习方式</b>
          <div style={{ marginTop: 8 }}>逐题实战：AI 面试官围绕 JD 与简历深挖，回答后给点评与追问</div>
          <div className="iv-foot" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn primary" onClick={() => void startDrill()}>
              🎤 开始模拟面试
            </button>
            <button className="btn" onClick={() => void loadPrep()}>
              🎯 先看预测题
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'prep' ? (
        <>
          <div className="tl-note" style={{ marginTop: 10 }}>
            针对该 JD 预测的最可能被问到的问题（含考察点与 STAR 建议），供你提前准备。
          </div>
          <div className="prep-list">
            {(prep ?? []).map((q, i) => (
              <div key={i} className="prep-item">
                <div className="pq">{i + 1}. {q.q}</div>
                <div className="pmeta"><b>考察</b> · {q.intent}</div>
                <div className="pmeta">💡 {q.starHint}</div>
              </div>
            ))}
          </div>
          <div className="iv-foot">
            <button className="btn sm primary" onClick={() => setPhase('intro')}>
              ← 返回
            </button>
            <button className="btn sm" onClick={() => void startDrill()}>
              去实战练习
            </button>
          </div>
        </>
      ) : null}

      {phase === 'drill' && drill.curQ ? (
        <>
          <div className="qa-q">
            <div className="lab">面试官 · 第 {drill.turn} 题</div>
            <div className="txt">{drill.curQ}</div>
          </div>
          <div className="qa-answer">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="输入你的回答…（用 STAR 讲清情境 / 任务 / 行动 / 结果，尽量带量化）"
              disabled={drill.busy}
            />
            <div className="ops">
              <button className="btn sm" disabled={drill.busy} onClick={() => void submit({ skip: true })}>
                跳过
              </button>
              <button
                className="btn sm primary"
                disabled={drill.busy || !answer.trim()}
                onClick={() => void submit()}
              >
                {drill.busy ? '点评中…' : '提交回答'}
              </button>
            </div>
          </div>
          {drill.feedback ? (
            <div className="qa-feedback">
              <div className="lab">🤖 AI 点评（针对你上一句）</div>
              <div className="txt">{drill.feedback}</div>
            </div>
          ) : null}
          <div className="iv-foot">
            <button className="btn sm" disabled={drill.busy} onClick={() => void endDrill()}>
              结束面试
            </button>
          </div>
        </>
      ) : null}

      {phase === 'done' && drill.wrapup ? (
        <>
          <div className="qa-feedback">
            <div className="lab">🎉 模拟面试结束 · 总结</div>
            <div className="txt">{drill.wrapup.feedback}</div>
          </div>
          {drill.wrapup.suggestions.length ? (
            <div className="prep-list">
              <div className="tl-note" style={{ marginTop: 6 }}>后续提升建议：</div>
              {drill.wrapup.suggestions.map((s, i) => (
                <div key={i} className="prep-item">
                  <div className="pq">{i + 1}. {s}</div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="iv-foot">
            <button className="btn sm primary" onClick={reset}>
              🔄 再来一轮
            </button>
            <button className="btn sm" onClick={() => void loadPrep()}>
              看预测题
            </button>
          </div>
        </>
      ) : null}

      {err ? <div className="error-note">{err}</div> : null}
    </div>
  );
}
