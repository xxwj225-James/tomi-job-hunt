/**
 * Command router — console sends → session lookup → dispatch or buffer.
 *
 * Online target  : dispatch immediately, arm the Ack clock (5s, from dispatch).
 * Offline target : enqueue into a per-target bounded buffer (TTL ~30s,
 *                  drop-oldest) and reply pending; when the agent reconnects
 *                  and re-registers the session, flush → dispatch → restart
 *                  the Ack clock. Buffer expiry → failed{tab-offline}.
 *
 * Timings are overridable via TOMI_AGENT_ACK_MS / TOMI_AGENT_BUFFER_TTL_MS /
 * TOMI_AGENT_GRACE_MS so the manual ws-agent-check.mjs can exercise the
 * timeout/cleanup paths without waiting 30s.
 */
import type { Logger } from '../../logger.js';
import { AckTracker, classifyFailure } from './timeout.js';
import { SessionRegistry, type SessionEntry } from './sessions.js';
import type {
  AgentToGateway,
  ConsoleToGateway,
  FailedReason,
  GatewayToAgent,
  GatewayToConsole,
  SessionInfo,
} from './types.js';

export interface RouterOptions {
  ackTimeoutMs?: number;
  bufferTtlMs?: number;
  bufferMax?: number;
  graceMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

/** Transport abstraction — makes the router unit-testable without a WS server. */
export interface RouterIO {
  sendToAgent(connectionId: string, msg: GatewayToAgent): void;
  sendToConsole(connectionId: string, msg: GatewayToConsole): void;
}

interface BufferedCommand {
  requestId: string;
  targetId: string;
  text: string;
  ttlTimer: ReturnType<typeof setTimeout>;
}

export class AgentRouter {
  private readonly sessions = new SessionRegistry();
  private readonly ack = new AckTracker();
  /** Registered agent connections (extension SW) — id → agentId (optional). */
  private readonly agents = new Map<string, string | undefined>();
  private readonly consoles = new Set<string>();
  /** requestId → console connection that issued it. */
  private readonly pendingConsole = new Map<string, string>();
  /** targetId → buffered commands (offline target, waiting for reconnect). */
  private readonly buffers = new Map<string, BufferedCommand[]>();

  private readonly ackTimeoutMs: number;
  private readonly bufferTtlMs: number;
  private readonly bufferMax: number;
  readonly graceMs: number;
  private readonly now: () => number;

  constructor(
    private readonly io: RouterIO,
    private readonly log: Logger,
    opts: RouterOptions = {},
  ) {
    this.ackTimeoutMs = opts.ackTimeoutMs ?? envMs('TOMI_AGENT_ACK_MS', 5000);
    this.bufferTtlMs = opts.bufferTtlMs ?? envMs('TOMI_AGENT_BUFFER_TTL_MS', 30_000);
    this.bufferMax = opts.bufferMax ?? 100;
    this.graceMs = opts.graceMs ?? envMs('TOMI_AGENT_GRACE_MS', 60_000);
    this.now = opts.now ?? Date.now;
  }

  // --- connection lifecycle ---

  agentClose(connectionId: string): void {
    this.agents.delete(connectionId);
    const now = this.now();
    this.sessions.markOffline(connectionId, now);
    this.log.info(`agent: connection closed, sessions marked offline`);
  }

  consoleClose(connectionId: string): void {
    this.consoles.delete(connectionId);
    for (const [requestId, owner] of [...this.pendingConsole]) {
      if (owner === connectionId) {
        this.ack.cancel(requestId);
        this.pendingConsole.delete(requestId);
        this.dropFromBuffers(requestId);
      }
    }
  }

  // --- agent messages (extension SW) ---

  onAgentMessage(connectionId: string, msg: AgentToGateway): void {
    if (!this.agents.has(connectionId)) this.agents.set(connectionId, undefined);

    switch (msg.type) {
      case 'hello': {
        this.agents.set(connectionId, msg.agentId);
        const now = this.now();
        for (const targetId of msg.sessionIds) {
          this.sessions.upsert(targetId, connectionId, undefined, now);
          this.flush(targetId);
        }
        break;
      }
      case 'session': {
        if (msg.action === 'upsert') {
          this.sessions.upsert(msg.targetId, connectionId, msg.tabId, this.now());
          this.flush(msg.targetId);
        } else {
          // Explicit removal — the target is gone; fail whatever is buffered.
          this.sessions.remove(msg.targetId);
          this.failBuffered(msg.targetId, 'tab-closed');
        }
        break;
      }
      case 'ping': {
        const now = this.now();
        for (const entry of this.sessions.byConnection(connectionId)) {
          this.sessions.touch(entry.targetId, now);
        }
        this.io.sendToAgent(connectionId, { type: 'pong', ts: msg.ts });
        break;
      }
      case 'ack': {
        this.ack.cancel(msg.requestId);
        const owner = this.pendingConsole.get(msg.requestId);
        this.pendingConsole.delete(msg.requestId);
        if (owner && this.consoles.has(owner)) {
          this.io.sendToConsole(owner, {
            type: 'ack',
            requestId: msg.requestId,
            ok: msg.ok,
            error: msg.error,
            domSnippet: msg.domSnippet,
          });
        }
        break;
      }
    }
  }

  // --- console messages (Agent UI) ---

  onConsoleMessage(connectionId: string, msg: ConsoleToGateway): void {
    this.consoles.add(connectionId);

    switch (msg.type) {
      case 'hello':
        this.io.sendToConsole(connectionId, {
          type: 'hello',
          ok: true,
          agents: this.agents.size,
          sessions: this.sessions.snapshot(),
        });
        break;
      case 'send': {
        this.pendingConsole.set(msg.requestId, connectionId);
        const entry = this.sessions.get(msg.targetId);
        if (entry && entry.status === 'online' && this.agents.has(entry.connectionId)) {
          this.dispatch(entry, msg.requestId, msg.targetId, msg.text);
        } else {
          this.enqueue(msg.requestId, msg.targetId, msg.text);
        }
        break;
      }
    }
  }

  // --- housekeeping ---

  /** Periodic: prune offline sessions past the grace window. */
  sweep(): void {
    const removed = this.sessions.prune(this.now(), this.graceMs);
    if (removed > 0) this.log.info(`agent: pruned ${removed} stale session(s)`);
  }

  // --- introspection (console hello / tests) ---

  get agentCount(): number {
    return this.agents.size;
  }

  get sessionCount(): number {
    return this.sessions.size();
  }

  snapshotSessions(): SessionInfo[] {
    return this.sessions.snapshot();
  }

  /** Buffered (awaiting reconnect) request ids, for tests/logs. */
  bufferedRequestIds(): string[] {
    return [...this.buffers.values()].flat().map((c) => c.requestId);
  }

  // --- internals ---

  private dispatch(entry: SessionEntry, requestId: string, targetId: string, text: string): void {
    this.io.sendToAgent(entry.connectionId, { type: 'dispatch', requestId, targetId, text });
    this.log.info(`agent: dispatched ${requestId.slice(0, 8)} → ${targetId} (${entry.connectionId.slice(0, 8)})`);
    // Ack clock starts from actual dispatch, not enqueue.
    this.ack.arm(requestId, this.ackTimeoutMs, () => {
      this.failOne(requestId, classifyFailure(this.sessions.get(targetId)));
    });
  }

  private enqueue(requestId: string, targetId: string, text: string): void {
    let buf = this.buffers.get(targetId);
    if (!buf) {
      buf = [];
      this.buffers.set(targetId, buf);
    }
    if (buf.length >= this.bufferMax) {
      // Bounded: drop-oldest.
      const dropped = buf.shift()!;
      clearTimeout(dropped.ttlTimer);
      this.failOne(dropped.requestId, 'tab-offline');
    }
    const cmd: BufferedCommand = {
      requestId,
      targetId,
      text,
      ttlTimer: setTimeout(() => this.onBufferExpire(requestId, targetId), this.bufferTtlMs),
    };
    buf.push(cmd);
    this.log.info(`agent: buffered ${requestId.slice(0, 8)} → ${targetId} (target offline, TTL ${this.bufferTtlMs}ms)`);
    const owner = this.pendingConsole.get(requestId);
    if (owner && this.consoles.has(owner)) {
      this.io.sendToConsole(owner, { type: 'pending', requestId, targetId });
    }
  }

  private onBufferExpire(requestId: string, targetId: string): void {
    this.dropFromBuffers(requestId);
    this.failOne(requestId, 'tab-offline');
  }

  private dropFromBuffers(requestId: string): void {
    for (const [targetId, buf] of [...this.buffers]) {
      const idx = buf.findIndex((c) => c.requestId === requestId);
      if (idx !== -1) {
        clearTimeout(buf[idx]!.ttlTimer);
        buf.splice(idx, 1);
      }
      if (buf.length === 0) this.buffers.delete(targetId);
    }
  }

  private failBuffered(targetId: string, reason: FailedReason): void {
    const buf = this.buffers.get(targetId);
    if (!buf) return;
    this.buffers.delete(targetId);
    for (const cmd of buf) {
      clearTimeout(cmd.ttlTimer);
      this.failOne(cmd.requestId, reason);
    }
  }

  private flush(targetId: string): void {
    const buf = this.buffers.get(targetId);
    if (!buf || buf.length === 0) return;
    const entry = this.sessions.get(targetId);
    if (!entry || entry.status !== 'online' || !this.agents.has(entry.connectionId)) return;
    this.buffers.delete(targetId);
    this.log.info(`agent: flushing ${buf.length} buffered command(s) → ${targetId}`);
    for (const cmd of buf) {
      clearTimeout(cmd.ttlTimer);
      // Ack clock restarts from dispatch here.
      this.dispatch(entry, cmd.requestId, cmd.targetId, cmd.text);
    }
  }

  private failOne(requestId: string, reason: FailedReason): void {
    this.ack.cancel(requestId);
    const owner = this.pendingConsole.get(requestId);
    this.pendingConsole.delete(requestId);
    if (owner && this.consoles.has(owner)) {
      this.io.sendToConsole(owner, { type: 'failed', requestId, reason });
    }
  }
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
