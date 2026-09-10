import { useCallback, useEffect, useRef, useState } from 'react';
import { api, setApiBase } from './lib/api';
import { GatewayClient, type GatewaySnapshot } from './lib/gateway';
import { JdEvents } from './lib/jd-events';
import { REASON_LABEL, type Health, type JdRecord, type SendState } from './lib/types';
import { WindowFrame } from './components/WindowFrame';
import { JdList } from './pages/JdList';
import { JdDetail } from './pages/JdDetail';
import { ChatPanel } from './pages/ChatPanel';
import { MatchPanel } from './pages/MatchPanel';
import { TailorPanel } from './pages/TailorPanel';
import { InterviewPanel } from './pages/InterviewPanel';
import { FeedbackPanel } from './pages/FeedbackPanel';
import { SettingsPanel } from './pages/SettingsPanel';
import type { CoreStateMsg } from './env';

type Tab = 'detail' | 'chat' | 'match' | 'tailor' | 'interview' | 'board';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'detail', label: '📋 岗位详情' },
  { id: 'chat', label: '💬 聊天' },
  { id: 'match', label: '📄 简历匹配' },
  { id: 'tailor', label: '📝 定制简历' },
  { id: 'interview', label: '🎤 模拟面试' },
  { id: 'board', label: '📊 投递' },
];

const emptySnap: GatewaySnapshot = { connected: false, agents: 0, sessions: [] };
const emptySend: SendState = { state: 'idle', at: 0 };

export default function App(): JSX.Element {
  const [core, setCore] = useState<CoreStateMsg | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [jds, setJds] = useState<JdRecord[]>([]);
  const [selUid, setSelUid] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('detail');
  const [q, setQ] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gatewaySnap, setGatewaySnap] = useState<GatewaySnapshot>(emptySnap);
  const [sendStates, setSendStates] = useState<Record<string, SendState>>({});
  /** Last successful JD list load — shown in the side head so a frozen list is
   *  visible instead of silently indistinguishable from an empty one. */
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  /** True only while a USER-initiated refresh runs (the background poll must not
   *  flash the button). */
  const [refreshing, setRefreshing] = useState(false);

  const gatewayRef = useRef<GatewayClient | null>(null);
  const baseRef = useRef<string | null>(null);

  const setSendState = useCallback((uid: string, s: SendState | ((p: SendState) => SendState)): void => {
    setSendStates((prev) => {
      const baseState = prev[uid] ?? emptySend;
      return { ...prev, [uid]: typeof s === 'function' ? (s as (p: SendState) => SendState)(baseState) : s };
    });
  }, []);

  const refreshHealth = useCallback(async (): Promise<void> => {
    if (!baseRef.current) return;
    try {
      setHealth(await api.health());
    } catch {
      /* transient — core may be restarting */
    }
  }, []);

  const loadJds = useCallback(async (): Promise<void> => {
    if (!baseRef.current) return;
    try {
      const { records } = await api.listJds(60);
      setJds(records);
      setSyncedAt(Date.now());
      setSyncFailed(false);
      setSelUid((prev) => {
        if (prev && records.some((r) => r.jobUid === prev)) return prev;
        return records[0]?.jobUid ?? null;
      });
    } catch {
      // Keep the last good list (a transient core restart shouldn't blank the
      // UI) but SAY so — swallowing the error silently is how a stalled list
      // stayed indistinguishable from a healthy one.
      setSyncFailed(true);
    }
  }, []);

  // Subscribe to core lifecycle; own the API base + gateway per core session.
  useEffect(() => {
    const unsub = window.tomi?.onCoreState((s) => setCore(s));
    void window.tomi?.coreBase().then((b) => {
      if (b) setCore({ kind: 'adopted', base: b });
    });
    return () => unsub?.();
  }, []);

  // Core base changed → rewire API + gateway + polling. Any prior gateway is
  // torn down (even when only the port shifted), so we never reuse a socket
  // pointed at the old core.
  useEffect(() => {
    const base = core?.base ?? null;
    baseRef.current = base;
    setApiBase(base ?? '');

    // Drop whatever gateway existed for the previous base.
    if (gatewayRef.current) {
      gatewayRef.current._unsub?.();
      gatewayRef.current.close();
      gatewayRef.current = null;
      setGatewaySnap(emptySnap);
    }

    if (!base) {
      setJds([]);
      setSyncedAt(null);
      setSyncFailed(false);
      return undefined;
    }

    void refreshHealth();
    void loadJds();
    const healthTimer = window.setInterval(() => void refreshHealth(), 8000);
    const jdTimer = window.setInterval(() => void loadJds(), 15000);

    const gw = new GatewayClient(base);
    gatewayRef.current = gw;
    gw._unsub = gw.onSnapshot((snap) => setGatewaySnap(snap));
    gw.connect();

    // Push channel: core announces every JD library write, so a new job shows up
    // in ~1s instead of up to 15s — and, unlike a timer, this survives window
    // throttling (see lib/jd-events.ts). Debounced: one capture can emit
    // jd/saved and then jd/tagged moments later.
    let pushTimer: number | null = null;
    const scheduleRefresh = (): void => {
      if (pushTimer !== null) window.clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => {
        pushTimer = null;
        void loadJds();
        void refreshHealth();
      }, 300);
    };
    const events = new JdEvents(base);
    const unsubJd = events.onJd(scheduleRefresh);
    events.connect();

    // Belt and braces: whenever the user actually looks at the window, reconcile
    // immediately (a throttled poll may have missed minutes of updates).
    const onFocus = (): void => {
      void loadJds();
      void refreshHealth();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') onFocus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(healthTimer);
      window.clearInterval(jdTimer);
      if (pushTimer !== null) window.clearTimeout(pushTimer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubJd();
      events.close();
      gw._unsub?.();
      gw.close();
      if (gatewayRef.current === gw) gatewayRef.current = null;
    };
  }, [core?.base, refreshHealth, loadJds]);

  const base = core?.base;
  const coreReady = Boolean(base && core?.kind !== 'missing' && core?.kind !== 'stopped');

  // Desktop presence → honest DAU signal. Fires once per core session with the
  // real app version. Core only records it while the user has opted in (consent
  // OFF ⇒ markDaily is a no-op, zero network). SettingsPanel re-fires presence
  // when the user opts in mid-session.
  useEffect(() => {
    if (!coreReady) return;
    void window.tomi
      ?.appInfo()
      .then((i) => api.usagePresence(i.version))
      .catch(() => undefined);
  }, [coreReady]);

  const sessionFor = useCallback(
    (jobUid: string) => gatewaySnap.sessions.find((s) => s.targetId === `jd:${jobUid}`),
    [gatewaySnap.sessions],
  );

  const onRefresh = useCallback((): void => {
    setRefreshing(true);
    void Promise.all([loadJds(), refreshHealth()]).finally(() => setRefreshing(false));
  }, [loadJds, refreshHealth]);

  /** Drop one JD from the library. Optimistically removes the row (and moves the
   *  selection to its neighbour) before reconciling with core. Not permanent:
   *  browsing that job again re-imports it. */
  const handleDelete = useCallback(
    async (jobUid: string): Promise<void> => {
      const at = jds.findIndex((r) => r.jobUid === jobUid);
      const nextUid = jds[at + 1]?.jobUid ?? jds[at - 1]?.jobUid ?? null;
      try {
        await api.removeJd(jobUid);
      } catch {
        void loadJds(); // already gone / core busy — take the server's word
        return;
      }
      setJds((prev) => prev.filter((r) => r.jobUid !== jobUid));
      setSelUid((prev) => (prev === jobUid ? nextUid : prev));
      void loadJds(); // refresh the count + anything else that changed
    },
    [jds, loadJds],
  );

  const selected = jds.find((r) => r.jobUid === selUid) ?? null;
  const sessionsOnline = gatewaySnap.sessions.filter((s) => s.status === 'online').length;

  async function handleSend(text: string): Promise<void> {
    const jd = jds.find((r) => r.jobUid === selUid);
    const gw = gatewayRef.current;
    if (!jd || !gw) return;
    const targetId = `jd:${jd.jobUid}`;
    setSendState(jd.jobUid, { state: 'sending', at: Date.now() });
    const unsubPending = gw.onPending((_requestId, tid) => {
      if (tid === targetId) {
        setSendState(jd.jobUid, (s) => ({ ...s, state: 'pending', note: REASON_LABEL['tab-idle'] }));
      }
    });
    const outcome = await gw.send(targetId, text);
    unsubPending();
    if (outcome.kind === 'ok') {
      setSendState(jd.jobUid, {
        state: 'ok',
        domSnippet: outcome.domSnippet,
        recruiter: outcome.recruiter,
        at: Date.now(),
      });
    } else if (outcome.kind === 'failed') {
      setSendState(jd.jobUid, { state: 'failed', reason: outcome.reason, at: Date.now() });
    } else {
      setSendState(jd.jobUid, { state: 'failed', note: outcome.error, at: Date.now() });
    }
  }

  const currentSend = selected ? (sendStates[selected.jobUid] ?? null) : null;

  return (
    <div className="win">
      <WindowFrame
        core={core}
        provider={health?.provider}
        agents={gatewaySnap.agents}
        sessionsOnline={sessionsOnline}
        jdContext={selected ? `${selected.company} · ${selected.title}` : undefined}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="work">
        <aside className="side">
          <JdList
            jds={jds}
            selUid={selected?.jobUid ?? null}
            onSelect={(uid) => setSelUid(uid)}
            searchQ={q}
            onSearch={setQ}
            sessionFor={sessionFor}
            syncedAt={syncedAt}
            syncFailed={syncFailed}
            refreshing={refreshing}
            onRefresh={onRefresh}
            onDelete={handleDelete}
          />
        </aside>

        <main className="work-main">
          <div className="tabbar">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
            <span className="spacer" />
            <span className="tab-hint">选中左侧 JD，右侧为该 JD 的全部能力</span>
          </div>

          <div className="panel">
            {!coreReady || !core?.base ? (
              <div className="empty-panel" style={{ marginTop: '8vh' }}>
                <b>{core?.kind === 'missing' ? '本地服务（core）未构建' : core?.kind === 'forked' ? '正在启动本地服务…' : core?.kind === 'stopped' ? '本地服务已停止' : '正在连接本地服务…'}</b>
                {core?.kind === 'missing' ? (
                  <>
                    <span>请先在仓库根目录执行 <code>npm run build -w core</code>，然后重启本应用。</span>
                    <div style={{ marginTop: 8 }}>{core.reason ?? ''}</div>
                  </>
                ) : null}
              </div>
            ) : tab !== 'board' && !selected ? (
              <div className="empty-panel" style={{ marginTop: '8vh' }}>
                <b>JD 库为空</b>
                <span>浏览 Boss直聘 / 猎聘岗位时，插件会自动把岗位沉淀到这里的 JD 库。</span>
              </div>
            ) : null}

            {coreReady && core?.base ? (
              selected && tab === 'detail' ? (
                <JdDetail key={selected.jobUid} jd={selected} />
              ) : selected && tab === 'chat' ? (
                <ChatPanel
                  key={selected.jobUid}
                  jd={selected}
                  session={sessionFor(selected.jobUid)}
                  gatewayConnected={gatewaySnap.connected}
                  agents={gatewaySnap.agents}
                  sendState={currentSend}
                  onSend={(text) => void handleSend(text)}
                />
              ) : selected && tab === 'match' ? (
                <MatchPanel
                  key={selected.jobUid}
                  jd={selected}
                  onGotoChat={() => setTab('chat')}
                  onGotoInterview={() => setTab('interview')}
                />
              ) : selected && tab === 'tailor' ? (
                <TailorPanel key={selected.jobUid} jd={selected} />
              ) : selected && tab === 'interview' ? (
                <InterviewPanel key={selected.jobUid} jd={selected} />
              ) : tab === 'board' ? (
                <FeedbackPanel key={selected?.jobUid ?? 'board'} jd={selected} />
              ) : null
            ) : null}
          </div>
        </main>
      </div>

      <footer className="adstrip">
        <span>🤖 TomiHunt Agent</span>
        <span>·</span>
        <span>本地优先 · 数据默认不出本机（可选匿名统计，默认关闭）</span>
        <span>·</span>
        <a onClick={() => setSettingsOpen(true)}>设置</a>
      </footer>

      {settingsOpen ? (
        <SettingsPanel base={base} onClose={() => setSettingsOpen(false)} onConfigSaved={() => void refreshHealth()} />
      ) : null}
    </div>
  );
}
