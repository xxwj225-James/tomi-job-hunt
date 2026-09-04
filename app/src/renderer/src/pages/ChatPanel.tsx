import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { REASON_LABEL, SOURCE_LABEL, toJdParams, type JdRecord, type SendState, type SessionInfo } from '../lib/types';
import { PitchEditor } from '../components/PitchEditor';
import { FeedbackBar } from '../components/FeedbackBar';

interface Props {
  jd: JdRecord;
  session?: SessionInfo;
  gatewayConnected: boolean;
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

export function ChatPanel({ jd, session, gatewayConnected, sendState, onSend }: Props): JSX.Element {
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
            {jd.hrName ? <span className="chip t" style={{ marginLeft: 6 }}>{jd.hrName}</span> : null}
            <span className="chip" style={{ marginLeft: 4 }}>{jd.title}</span>
          </div>
          <div className="meta">
            {SOURCE_LABEL[jd.source]} · 采集于 {new Date(jd.capturedAt).toLocaleString('zh-CN', { hour12: false })}
          </div>
        </div>
        <span className={`st${sessionOn ? '' : ' off'}`}>
          {sessionOn ? '● 聊天窗口在线' : '聊天窗口离线'}
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
          {sendState.state === 'ok' ? `已填入浏览器聊天框并高亮，请在浏览器中确认后发送（插件不会自动发送）。${sendState.domSnippet ? '（' + sendState.domSnippet + '）' : ''}` : ''}
          {sendState.state === 'pending' ? '⏳ 目标聊天页当前离线——插件正在唤醒，消息已在网关缓冲（约 30s）。' : ''}
          {sendState.state === 'failed' ? `填入失败：${sendState.reason ? REASON_LABEL[sendState.reason] : sendState.note ?? '未知原因'}` : ''}
        </div>
      ) : null}

      <div className="send-note">
        需要 Chrome/Edge 打开该 JD 的聊天窗口并加载插件，才可真实送达；失败原因（页面关闭 / 离线 / 选择器失效）会回显在这里。
      </div>
    </div>
  );
}
