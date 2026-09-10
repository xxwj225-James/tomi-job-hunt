import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { REASON_LABEL, SOURCE_LABEL, toJdParams, type JdRecord, type SendState, type SessionInfo } from '../lib/types';
import { PitchEditor } from '../components/PitchEditor';
import { FeedbackBar } from '../components/FeedbackBar';

interface Props {
  jd: JdRecord;
  session?: SessionInfo;
  gatewayConnected: boolean;
  /** Connected browser extensions — 0 means the plugin itself is not running. */
  agents: number;
  sendState: SendState | null;
  onSend: (text: string) => void;
}

interface Bubble {
  text: string;
  ok: boolean;
  at: number;
}

/** In-session pitch/bubbles per JD — survives tab remounts within a session. */
const pitchCache = new Map<string, string>();
const bubbleCache = new Map<string, Bubble[]>();

/** What the user must open in the browser before a fill can land (per source). */
function openPageHint(jd: JdRecord): string {
  return jd.source === 'liepin'
    ? '打开该 JD 的猎聘详情页（聊天浮层会自动弹出）'
    : '打开该岗位的 Boss 直聘聊天窗口';
}

/**
 * Why a fill can't land right now, in the user's terms.
 *
 * "插件未上线/窗口离线超时" merged two unrelated causes: the extension not
 * running at all, and the extension running fine but this job's chat tab never
 * having been opened. It is the TAB that registers a session — the background
 * worker only relays it — so a job whose chat page was never opened has no
 * session no matter how healthy the plugin is. Measured live: agents=1,
 * sessions=0, reported to the user as "插件未上线", which sent them looking in
 * the wrong place entirely.
 */
function offlineHint(jd: JdRecord, agents: number): string {
  if (agents === 0) return '浏览器里的 TomiHunt 插件未连接（请确认插件已启用、浏览器正在运行）';
  return `插件已连接，但该岗位的聊天窗口还没有打开——请先在浏览器${openPageHint(jd)}`;
}

export function ChatPanel({ jd, session, gatewayConnected, agents, sendState, onSend }: Props): JSX.Element {
  const uid = jd.jobUid;
  const [pitch, setPitch] = useState(() => pitchCache.get(uid) ?? '');
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [bubbles, setBubbles] = useState<Bubble[]>(() => bubbleCache.get(uid) ?? []);

  useEffect(() => {
    setPitch(pitchCache.get(uid) ?? '');
    setBubbles(bubbleCache.get(uid) ?? []);
  }, [uid]);

  useEffect(() => {
    pitchCache.set(uid, pitch);
  }, [uid, pitch]);

  const sessionOn = session?.status === 'online';
  const offlineWhy = offlineHint(jd, agents);

  // After a successful fill the page tells us who the chat is actually with —
  // a posting can rotate recruiters, so the live counterpart overrides the
  // (possibly stale) hrName snapshot stored at capture time.
  const liveRecruiter = sendState?.state === 'ok' && sendState.recruiter ? sendState.recruiter : undefined;

  async function generate(feedback?: string): Promise<void> {
    setGenerating(true);
    setGenErr('');
    try {
      const tags = jd.tags ? { techStack: jd.tags.techStack, summary: jd.tags.summary } : undefined;
      // Personal-rules injection — same merge the extension does
      // (extension/src/content/shared.ts:751): accumulated thumbs/tags/notes
      // steer every generation, plus this one-off rewrite note.
      const view = await api.feedbackGet().catch(() => null);
      const effectiveFeedback = [view?.rules, feedback?.trim()].filter(Boolean).join('\n') || undefined;
      const res = await api.greeting(toJdParams(jd), effectiveFeedback, tags);
      setPitch(res.pitch);
      if (res.warning) setGenErr(res.warning);
      else setGenErr('');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      setGenErr(msg);
    } finally {
      setGenerating(false);
    }
  }

  function handleSend(): void {
    const text = pitch.trim();
    if (!text || !gatewayConnected) return;
    const next = [...bubbles, { text, ok: false, at: Date.now() }];
    setBubbles(next);
    bubbleCache.set(uid, next);
    onSend(text);
  }

  // Mark the newest matching bubble ok once the gateway reports success.
  useEffect(() => {
    if (sendState?.state === 'ok' && bubbles.length && !bubbles[bubbles.length - 1]!.ok) {
      const next = bubbles.map((b, i) => (i === bubbles.length - 1 ? { ...b, ok: true } : b));
      setBubbles(next);
      bubbleCache.set(uid, next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendState?.state]);

  const sending = sendState?.state === 'sending' || sendState?.state === 'pending';

  return (
    <div>
      <div className="chat-head">
        <div>
          <div className="who">
            {jd.company}
            {liveRecruiter || jd.hrName ? (
              <span
                className="chip t"
                style={{ marginLeft: 6, ...(liveRecruiter ? { color: '#188038', fontWeight: 600 } : {}) }}
                title={
                  liveRecruiter
                    ? `页面实时联系人：${liveRecruiter}（填入聊天框时从页面读取）`
                    : `采集时记录的联系人：${jd.hrName}`
                }
              >
                {liveRecruiter ?? jd.hrName}
              </span>
            ) : null}
            <span className="chip" style={{ marginLeft: 4 }}>{jd.title}</span>
          </div>
          <div className="meta">
            {SOURCE_LABEL[jd.source]} · 采集于 {new Date(jd.capturedAt).toLocaleString('zh-CN', { hour12: false })}
          </div>
        </div>
        <span
          className={`st${sessionOn ? '' : ' off'}`}
          title={sessionOn ? '页面在线，可填入聊天框' : `离线：${offlineWhy}`}
        >
          {sessionOn ? '● 聊天窗口在线' : agents === 0 ? '插件未连接' : '聊天窗口离线'}
        </span>
      </div>

      {bubbles.length > 0 ? (
        <div className="bubbles">
          {bubbles.map((b, i) => (
            <div key={i} className="bubble me" title={b.ok ? '已填入待发送' : '待发送'}>
              {b.text}
            </div>
          ))}
        </div>
      ) : null}

      <div className="tl-note" style={{ marginTop: 10, marginBottom: 4 }}>
        两阶段生成：先针对 JD + 简历提取可用的「匹配点」，再据此写一条自然得体的打招呼语——只改写表述，绝不编造简历里没有的经历。
      </div>

      <PitchEditor
        value={pitch}
        onChange={setPitch}
        onRegenerate={() => void generate()}
        onRegenerateWith={(fb) => void generate(fb)}
        busy={generating}
      />

      {genErr ? <div className="warn-note">{genErr}</div> : null}

      {pitch.trim() ? <FeedbackBar feature="greeting" /> : null}

      {sendState?.state === 'ok' && sendState.domSnippet ? (
        <div className="send-result ok">✔ 页面反馈：{sendState.domSnippet}</div>
      ) : null}

      <div className="send-row">
        <div className="target">
          发送到 <b>{jd.company}</b> · {SOURCE_LABEL[jd.source]}
          {sessionOn ? ' · Tab 在线' : ' · Tab 离线（将等待插件唤醒）'}
        </div>
        {!pitch.trim() ? (
          <button className="btn primary" disabled={generating} onClick={() => void generate()}>
            {generating ? '生成中…' : '✨ 生成话术'}
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={sending || !gatewayConnected}
            onClick={handleSend}
            title={gatewayConnected ? '填入浏览器聊天框，由你确认后发送（插件不会自动发送）' : '网关未连接'}
          >
            {sendState?.state === 'ok' ? '✔ 已填入待确认' : sending ? '填入中…' : '📤 填入聊天框'}
          </button>
        )}
      </div>

      {sendState && sendState.state !== 'idle' ? (
        <div
          className={`send-result ${
            sendState.state === 'ok' ? 'ok' : sendState.state === 'failed' ? 'err' : 'wait'
          }`}
        >
          {sendState.state === 'ok' ? `${sendState.recruiter ? `正在与 ${sendState.recruiter} 沟通。` : ''}已填入浏览器聊天框并高亮，请在浏览器中确认后发送（插件不会自动发送）。${sendState.domSnippet ? '（' + sendState.domSnippet + '）' : ''}` : ''}
          {sendState.state === 'pending' ? '⏳ 目标页面当前离线，消息已缓冲（约 30s）：请现在到浏览器打开对应页面，会自动填入；超时则失败。' : ''}
          {sendState.state === 'failed'
            ? `填入失败：${
                sendState.reason === 'tab-offline'
                  ? offlineWhy
                  : sendState.reason
                    ? REASON_LABEL[sendState.reason]
                    : sendState.note ?? '未知原因'
              }`
            : ''}
        </div>
      ) : null}

      <div className="send-note">
        {sessionOn
          ? '填入后请到浏览器确认内容再发送（插件不会自动发送）。失败原因（页面关闭 / 离线 / 选择器失效）会回显在这里。'
          : `${offlineWhy}，再点「填入聊天框」；消息会缓冲约 30s，期间页面打开即自动填入。`}
      </div>
    </div>
  );
}
