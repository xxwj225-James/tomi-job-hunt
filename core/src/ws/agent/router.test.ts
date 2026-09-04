import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../logger.js';
import { AgentRouter, type RouterOptions } from './router.js';
import type { AgentToGateway, ConsoleToGateway, GatewayToAgent, GatewayToConsole } from './types.js';

const silentLog = new Logger('error', 'test');
const AGENT = 'conn-agent';
const CONSOLE = 'conn-console';

interface Sent {
  to: string;
  msg: unknown;
}

class Harness {
  router: AgentRouter;
  agentOut: Sent[] = [];
  consoleOut: Sent[] = [];

  constructor(opts: RouterOptions = {}) {
    this.router = new AgentRouter(
      {
        sendToAgent: (to, msg: GatewayToAgent) => this.agentOut.push({ to, msg }),
        sendToConsole: (to, msg: GatewayToConsole) => this.consoleOut.push({ to, msg }),
      },
      silentLog,
      { ackTimeoutMs: 5000, bufferTtlMs: 30_000, graceMs: 60_000, bufferMax: 100, ...opts },
    );
  }

  consoleMsgs(): GatewayToConsole[] {
    return this.consoleOut.map((x) => x.msg as GatewayToConsole);
  }
  agentMsgs(): GatewayToAgent[] {
    return this.agentOut.map((x) => x.msg as GatewayToAgent);
  }
  lastConsole(): GatewayToConsole {
    return this.consoleMsgs().at(-1)!;
  }
  dispatches(): GatewayToAgent[] {
    return this.agentMsgs().filter((m): m is GatewayToAgent & { type: 'dispatch' } => m.type === 'dispatch');
  }
}

function agentHello(sessionIds: string[]): AgentToGateway {
  return { type: 'hello', role: 'agent', agentId: 'agent-1', sessionIds };
}
function agentAck(requestId: string, ok: boolean): AgentToGateway {
  return { type: 'ack', requestId, ok };
}
function consoleSend(requestId: string, targetId: string, text = 'hi'): ConsoleToGateway {
  return { type: 'send', requestId, targetId, text };
}

describe('AgentRouter — online path', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('registers an agent session and dispatches a console send straight through', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));

    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1', '你好'));
    expect(h.dispatches()).toEqual([{ type: 'dispatch', requestId: 'r1', targetId: 't1', text: '你好' }]);
    // No pending — the target was online.
    expect(h.consoleMsgs().some((m) => m.type === 'pending')).toBe(false);
  });

  it('routes an ack back to the issuing console and clears the clock', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.onAgentMessage(AGENT, agentAck('r1', true));
    expect(h.lastConsole()).toMatchObject({ type: 'ack', requestId: 'r1', ok: true });
    // Clock cancelled — no failed fires later.
    vi.advanceTimersByTime(10_000);
    expect(h.consoleMsgs().filter((m) => m.type === 'failed')).toHaveLength(0);
  });

  it('hello to a console returns the session snapshot + agent count', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1', 't2']));
    h.router.onConsoleMessage(CONSOLE, { type: 'hello', role: 'console' });
    const hello = h.lastConsole();
    expect(hello).toMatchObject({ type: 'hello', ok: true, agents: 1 });
    expect((hello as { sessions: unknown[] }).sessions).toHaveLength(2);
  });
});

describe('AgentRouter — offline buffer (SW sleep window)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('buffers a send to an offline target, replies pending, flushes on reconnect', () => {
    const h = new Harness();
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    expect(h.lastConsole()).toMatchObject({ type: 'pending', requestId: 'r1', targetId: 't1' });
    expect(h.router.bufferedRequestIds()).toEqual(['r1']);
    expect(h.dispatches()).toHaveLength(0);

    // Agent (re)connects and re-registers the session → flush → dispatch.
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    expect(h.dispatches()).toEqual([{ type: 'dispatch', requestId: 'r1', targetId: 't1', text: 'hi' }]);
    expect(h.router.bufferedRequestIds()).toEqual([]);

    h.router.onAgentMessage(AGENT, agentAck('r1', true));
    expect(h.lastConsole()).toMatchObject({ type: 'ack', requestId: 'r1', ok: true });
  });

  it('expires a buffered command with failed{tab-offline} when no reconnect arrives', () => {
    const h = new Harness();
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    expect(h.lastConsole()).toMatchObject({ type: 'pending' });
    vi.advanceTimersByTime(30_000);
    expect(h.lastConsole()).toMatchObject({ type: 'failed', requestId: 'r1', reason: 'tab-offline' });
    expect(h.router.bufferedRequestIds()).toEqual([]);
  });

  it('explicit session remove fails buffered commands immediately with tab-closed', () => {
    const h = new Harness();
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.onAgentMessage(AGENT, { type: 'session', action: 'remove', targetId: 't1' });
    expect(h.lastConsole()).toMatchObject({ type: 'failed', requestId: 'r1', reason: 'tab-closed' });
  });

  it('drops the oldest command when the buffer is bounded', () => {
    const h = new Harness({ bufferMax: 2 });
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r2', 't1'));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r3', 't1'));
    const failed = h.consoleMsgs().filter((m) => m.type === 'failed');
    expect(failed).toEqual([{ type: 'failed', requestId: 'r1', reason: 'tab-offline' }]);
    expect(h.router.bufferedRequestIds().sort()).toEqual(['r2', 'r3']);
  });
});

describe('AgentRouter — ack timeout classification', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('session gone by the deadline → tab-closed', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.onAgentMessage(AGENT, { type: 'session', action: 'remove', targetId: 't1' });
    vi.advanceTimersByTime(5000);
    expect(h.lastConsole()).toMatchObject({ type: 'failed', requestId: 'r1', reason: 'tab-closed' });
  });

  it('connection dropped by the deadline → tab-idle', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.agentClose(AGENT);
    vi.advanceTimersByTime(5000);
    expect(h.lastConsole()).toMatchObject({ type: 'failed', requestId: 'r1', reason: 'tab-idle' });
  });

  it('still online but no ack → selector-failed', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    vi.advanceTimersByTime(5000);
    expect(h.lastConsole()).toMatchObject({ type: 'failed', requestId: 'r1', reason: 'selector-failed' });
  });
});

describe('AgentRouter — lifecycle & cleanup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sweep prunes offline sessions past the grace window', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    expect(h.router.sessionCount).toBe(1);
    h.router.agentClose(AGENT);
    expect(h.router.sessionCount).toBe(1); // offline but within grace
    vi.advanceTimersByTime(60_000);
    h.router.sweep();
    expect(h.router.sessionCount).toBe(0);
  });

  it('console close abandons its buffered/pending sends (no late failed)', () => {
    const h = new Harness();
    h.router.onConsoleMessage(CONSOLE, consoleSend('r1', 't1'));
    h.router.consoleClose(CONSOLE);
    const before = h.consoleMsgs().length;
    vi.advanceTimersByTime(60_000);
    expect(h.consoleMsgs().length).toBe(before); // no late failed to a gone console
    // The abandoned command was dropped from the buffer — a later reconnect
    // does NOT dispatch it (no one is left to receive the result).
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    expect(h.dispatches()).toHaveLength(0);
    expect(h.router.bufferedRequestIds()).toEqual([]);
  });

  it('ping refreshes session lastSeen and answers pong', () => {
    const h = new Harness();
    h.router.onAgentMessage(AGENT, agentHello(['t1']));
    h.router.onAgentMessage(AGENT, { type: 'ping', ts: 123 });
    expect(h.lastConsole()).toBeUndefined();
    expect(h.agentMsgs()).toContainEqual({ type: 'pong', ts: 123 });
  });
});
