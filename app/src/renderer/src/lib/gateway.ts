/**
 * Console WS client to core's /agent gateway (ws://127.0.0.1:<port>/agent).
 *
 * Protocol (core/src/ws/agent/types.ts):
 *   console → gateway: {type:'hello',role:'console'} | {type:'send',requestId,targetId,text}
 *   gateway → console: hello{ok,agents,sessions} | pending{requestId} | ack{requestId,ok,error?,domSnippet?} | failed{requestId,reason}
 *
 * Sessions are only snapshotted on console hello, so we re-send hello on an
 * interval to pick up chat tabs that open/close while the App is connected.
 * The send() promise resolves on ack/failed; 'pending' is reported through
 * onPending so the UI can show "waiting for the extension to wake up".
 */
import type { FailedReason, SessionInfo, SendOutcome } from './types';

export interface GatewaySnapshot {
  connected: boolean;
  agents: number;
  sessions: SessionInfo[];
}

type SnapshotCb = (s: GatewaySnapshot) => void;
type PendingCb = (requestId: string, targetId: string) => void;

const HELLO_INTERVAL_MS = 5000;
const SEND_TIMEOUT_MS = 90_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private helloTimer: number | null = null;
  private closed = false;

  connected = false;
  agents = 0;
  sessions: SessionInfo[] = [];

  /** Optional owner-unsubscribe for the snapshot listener (set by App). */
  _unsub: (() => void) | null = null;

  private readonly snapCbs = new Set<SnapshotCb>();
  private readonly pendingCbs = new Set<PendingCb>();
  private readonly inflight = new Map<string, (o: SendOutcome) => void>();

  constructor(private readonly wsBase: string) {}

  private get url(): string {
    return `${this.wsBase.replace(/^http/, 'ws')}/agent`;
  }

  connect(): void {
    if (this.ws || this.closed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.sendHello();
      this.helloTimer = window.setInterval(() => this.sendHello(), HELLO_INTERVAL_MS);
      this.emit();
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        this.agents = Number(msg.agents ?? 0);
        this.sessions = Array.isArray(msg.sessions) ? (msg.sessions as SessionInfo[]) : [];
        this.emit();
      } else if (msg.type === 'pending') {
        const id = String(msg.requestId ?? '');
        this.pendingCbs.forEach((cb) => cb(id, String(msg.targetId ?? '')));
      } else if (msg.type === 'ack') {
        const resolve = this.inflight.get(String(msg.requestId));
        if (resolve) {
          this.inflight.delete(String(msg.requestId));
          resolve({
            kind: msg.ok === false ? 'error' : 'ok',
            ...(msg.error !== undefined ? { error: String(msg.error) } : {}),
            ...(msg.domSnippet !== undefined ? { domSnippet: String(msg.domSnippet) } : {}),
          });
        }
      } else if (msg.type === 'failed') {
        const resolve = this.inflight.get(String(msg.requestId));
        if (resolve) {
          this.inflight.delete(String(msg.requestId));
          resolve({ kind: 'failed', reason: String(msg.reason) as FailedReason });
        }
      }
    };

    const teardown = (): void => {
      this.connected = false;
      this.ws = null;
      if (this.helloTimer) window.clearInterval(this.helloTimer);
      this.helloTimer = null;
      if (!this.closed) this.scheduleReconnect();
      this.emit();
    };
    ws.onclose = teardown;
    ws.onerror = () => {
      // onclose always follows; just force-close here to trigger teardown.
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  private retry = 0;
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.retry, 8000);
    this.retry += 1;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  private sendHello(): void {
    this.sendRaw({ type: 'hello', role: 'console' });
  }

  private sendRaw(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private emit(): void {
    const snap: GatewaySnapshot = {
      connected: this.connected,
      agents: this.agents,
      sessions: [...this.sessions],
    };
    this.snapCbs.forEach((cb) => cb(snap));
  }

  onSnapshot(cb: SnapshotCb): () => void {
    this.snapCbs.add(cb);
    return () => this.snapCbs.delete(cb);
  }

  onPending(cb: PendingCb): () => void {
    this.pendingCbs.add(cb);
    return () => this.pendingCbs.delete(cb);
  }

  /** Session lookup helper used by the JD list badge. */
  sessionFor(targetId: string): SessionInfo | undefined {
    return this.sessions.find((s) => s.targetId === targetId);
  }

  send(targetId: string, text: string): Promise<SendOutcome> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ kind: 'error', error: '网关未连接' });
    }
    return new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const timer = window.setTimeout(() => {
        this.inflight.delete(requestId);
        resolve({ kind: 'error', error: '等待插件应答超时' });
      }, SEND_TIMEOUT_MS);
      this.inflight.set(requestId, (o) => {
        window.clearTimeout(timer);
        resolve(o);
      });
      this.sendRaw({ type: 'send', requestId, targetId, text });
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    if (this.helloTimer) window.clearInterval(this.helloTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    for (const resolve of this.inflight.values()) resolve({ kind: 'error', error: '网关连接已关闭' });
    this.inflight.clear();
    this.emit();
  }
}
