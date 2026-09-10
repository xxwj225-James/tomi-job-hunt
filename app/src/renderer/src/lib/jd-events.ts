/**
 * JD library push client to core's /ws event bus.
 *
 * The JD 库 list used to refresh ONLY on a 15s poll, so a throttled/suspended
 * timer (Chromium throttles hidden and occluded windows by default) silently
 * froze the list with no visible symptom — the reported "打开 JD 后 agent 没有
 * 同步" bug. Core now broadcasts `jd/saved` on every store write; this client
 * turns that into an immediate list refresh. The poll stays as a fallback.
 *
 * Distinct from GatewayClient, which speaks the /agent console protocol. This
 * one is read-only: it parses the two library events and ignores everything
 * else on the bus (the extension's own `jd/tagged` watchdog relies on that).
 *
 * Wire types mirror core/src/types.ts WsEvent — the App can't import core types,
 * same hand-written convention as lib/types.ts.
 */

/** Core's library events: a record was written, its tags landed, or it was removed. */
export interface JdWireEvent {
  type: 'jd/saved' | 'jd/tagged' | 'jd/deleted';
  jobUid?: string;
}

const JD_EVENT_TYPES = new Set(['jd/saved', 'jd/tagged', 'jd/deleted']);

type JdCb = (event: JdWireEvent) => void;

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 8000;

export class JdEvents {
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private closed = false;
  private retry = 0;
  private readonly cbs = new Set<JdCb>();

  constructor(private readonly wsBase: string) {}

  private get url(): string {
    return `${this.wsBase.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws`;
  }

  connect(): void {
    if (this.ws || this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect(); // malformed base / ws unavailable
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type?: string; jobUid?: unknown };
      try {
        msg = JSON.parse(String(ev.data)) as { type?: string; jobUid?: unknown };
      } catch {
        return;
      }
      if (!msg.type || !JD_EVENT_TYPES.has(msg.type)) return; // other bus traffic
      const type = msg.type as JdWireEvent['type'];
      this.cbs.forEach((cb) =>
        cb({ type, ...(typeof msg.jobUid === 'string' ? { jobUid: msg.jobUid } : {}) }),
      );
    };

    const teardown = (): void => {
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onclose = teardown;
    ws.onerror = () => {
      // onclose always follows; force-close so teardown runs exactly once.
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.retryTimer !== null) return;
    const delay = Math.min(RETRY_BASE_MS * 2 ** this.retry, RETRY_MAX_MS);
    this.retry += 1;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.closed) this.connect();
    }, delay);
  }

  onJd(cb: JdCb): () => void {
    this.cbs.add(cb);
    return () => this.cbs.delete(cb);
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    this.cbs.clear();
  }
}
