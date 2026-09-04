/**
 * Background agent WebSocket client — the extension service worker speaks the
 * core /agent protocol as role 'agent' (core/src/ws/agent/types.ts):
 *
 *   agent   → gateway: hello{role,agentId,sessionIds} | session{upsert|remove}
 *                       | ping{ts} | ack{requestId,ok,error?,domSnippet?}
 *   gateway → agent:   dispatch{requestId,targetId,text} | pong{ts}
 *
 * One socket per SW lifetime, exponential-backoff reconnect. The caller
 * (index.ts) re-sends hello with the current sessionIds on every (re)open so
 * gateway offline-buffered sends flush the moment this agent comes back.
 */
import { _resetCoreBaseCache, getCoreBase } from '../core-client.js';

export interface DispatchMsg {
  type: 'dispatch';
  requestId: string;
  targetId: string;
  text: string;
}

type GatewayToAgent = DispatchMsg | { type: 'pong'; ts: number };

export type AckBody = { type: 'ack'; requestId: string; ok: boolean; error?: string; domSnippet?: string };

type Listener = (msg: GatewayToAgent) => void;
type OpenHandler = () => void;

const CORE_CACHE_KEY = 'tomihunt-core-base';

const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let openHandler: OpenHandler | null = null;
let desiredOpen = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryMs = 1000;

/** Caller hooks the point where a fresh socket is OPEN — send hello here. */
export function setOpenHandler(fn: OpenHandler | null): void {
  openHandler = fn;
}

export function isOpen(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

export function onMessage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** agent hello — re-registers our sessions under this connection. */
export function sendHello(sessionIds: string[]): void {
  sendRaw({ type: 'hello', role: 'agent', agentId: chrome.runtime.id, sessionIds });
}

/** Live session upsert/remove. upsert also triggers a gateway buffer flush. */
export function sendSession(action: 'upsert' | 'remove', targetId: string, tabId?: number): void {
  sendRaw({ type: 'session', action, targetId, tabId });
}

export function sendAck(ack: AckBody): void {
  sendRaw(ack);
}

export function ping(): void {
  sendRaw({ type: 'ping', ts: Date.now() });
}

function sendRaw(msg: unknown): void {
  if (isOpen() && ws) ws.send(JSON.stringify(msg));
}

/** Opens (or reopens) the socket; no-op when already open/connecting. */
export function open(): void {
  desiredOpen = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  void doConnect();
}

/** Stops reconnecting and drops the socket (e.g. extension unload). */
export function close(): void {
  desiredOpen = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const sock = ws;
  ws = null;
  if (sock) {
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  }
}

async function doConnect(): Promise<void> {
  if (!desiredOpen) return;
  const base = await getCoreBase();
  if (!desiredOpen) return; // closed while probing
  if (!base) {
    scheduleRetry();
    return;
  }
  const sock = new WebSocket(base.replace(/^http/, 'ws') + '/agent');
  ws = sock;
  let everOpened = false;

  sock.onopen = () => {
    if (ws !== sock) return;
    everOpened = true;
    retryMs = 1000;
    openHandler?.();
  };

  sock.onmessage = (ev: MessageEvent) => {
    if (ws !== sock) return;
    let msg: GatewayToAgent;
    try {
      msg = JSON.parse(String(ev.data)) as GatewayToAgent;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    for (const fn of listeners) fn(msg);
  };

  const teardown = (): void => {
    if (ws !== sock) return;
    ws = null;
    // A socket that died before ever opening usually means the cached core
    // port is stale (core restarted and shifted ports). Drop the cache so the
    // next probe re-discovers the live port instead of retrying a dead one.
    if (!everOpened) void invalidateCoreCache();
    if (desiredOpen) scheduleRetry();
  };
  sock.onclose = teardown;
  sock.onerror = () => {
    try {
      sock.close();
    } catch {
      /* noop */
    }
  };
}

function scheduleRetry(): void {
  if (!desiredOpen || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (desiredOpen) void doConnect();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, 8000);
}

async function invalidateCoreCache(): Promise<void> {
  _resetCoreBaseCache();
  try {
    await chrome.storage.local.remove(CORE_CACHE_KEY);
  } catch {
    /* best-effort */
  }
}
