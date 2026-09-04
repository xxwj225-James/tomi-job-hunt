/**
 * /agent — WebSocket gateway between the Agent UI (console) and the headless
 * extension (agent). Thin transport: validates + routes messages into the
 * AgentRouter, and owns the periodic stale-session sweep.
 *
 * The route shares the createNodeWebSocket instance with /ws (see ws/server.ts)
 * so the whole HTTP server gets a single WebSocketServer and one injectWebSocket
 * call.
 */
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import type { WebSocket } from 'ws';
import type { Logger } from '../../logger.js';
import { AgentRouter, type RouterIO } from './router.js';
import type { AgentToGateway, ConsoleToGateway } from './types.js';

type UpgradeWebSocket = ReturnType<typeof createNodeWebSocket>['upgradeWebSocket'];

/** Optional lifecycle callbacks (usage telemetry presence). */
export interface AgentGatewayHooks {
  /** Fired when a headless extension (agent role) sends its hello. */
  onAgentHello?: () => void;
}

/** Same env-override helper as router.ts, so ws-agent-check.mjs can fast-forward. */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Sweep cadence for pruning offline sessions past the grace window. */
const SWEEP_INTERVAL_MS = envMs('TOMI_AGENT_SWEEP_MS', 15_000);

export interface AgentGateway {
  router: AgentRouter;
}

function isWsOpen(ws: WSContext<WebSocket>): boolean {
  // 1 = OPEN (ws.OPEN). WSContext exposes readyState.
  return (ws as unknown as { readyState?: number }).readyState !== 3; // not CLOSED
}

export function createAgentGateway(
  app: Hono,
  log: Logger,
  upgradeWebSocket: UpgradeWebSocket,
  hooks?: AgentGatewayHooks,
): AgentGateway {
  const connections = new Map<string, WSContext<WebSocket>>();
  const ids = new WeakMap<WSContext<WebSocket>, string>();

  const io: RouterIO = {
    sendToAgent(connectionId, msg) {
      const ws = connections.get(connectionId);
      if (ws && isWsOpen(ws)) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* dead socket — the close handler cleans up */
        }
      }
    },
    sendToConsole(connectionId, msg) {
      const ws = connections.get(connectionId);
      if (ws && isWsOpen(ws)) {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          /* dead socket */
        }
      }
    },
  };

  const router = new AgentRouter(io, log.child('agent'));

  app.get(
    '/agent',
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        const connectionId = randomUUID();
        ids.set(ws, connectionId);
        connections.set(connectionId, ws);
        log.info(`agent: connection open (${connectionId.slice(0, 8)})`);
      },
      onMessage(evt, ws) {
        const connectionId = ids.get(ws);
        if (!connectionId) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(evt.data));
        } catch {
          return; // non-JSON — ignore
        }
        if (!raw || typeof raw !== 'object') return;
        const msg = raw as AgentToGateway | ConsoleToGateway;
        if ('type' in msg) {
          if (msg.type === 'send' || (msg.type === 'hello' && msg.role === 'console')) {
            router.onConsoleMessage(connectionId, msg as ConsoleToGateway);
          } else if (msg.type === 'hello' || msg.type === 'session' || msg.type === 'ack' || msg.type === 'ping') {
            router.onAgentMessage(connectionId, msg as AgentToGateway);
            // Agent-role hello only — the console hello was routed above. The
            // SW re-hellos on each ~30s reconnect, so the callee must be
            // idempotent per day (usage.markDaily is).
            if (msg.type === 'hello') hooks?.onAgentHello?.();
          }
        }
      },
      onClose(_evt, ws) {
        const connectionId = ids.get(ws);
        if (connectionId) {
          router.agentClose(connectionId);
          router.consoleClose(connectionId);
          connections.delete(connectionId);
          log.info(`agent: connection closed (${connectionId.slice(0, 8)})`);
        }
      },
      onError(evt) {
        log.warn(`agent: ws error: ${String(evt)}`);
      },
    })),
  );

  const sweepTimer = setInterval(() => router.sweep(), SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  return { router };
}
