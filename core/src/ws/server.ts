/**
 * WebSocket hub — job lifecycle events broadcast to all connected clients
 * (the browser extension, Phase 1+). Thin wrapper over @hono/node-ws.
 */
import { createNodeWebSocket } from '@hono/node-ws';
import type { Hono } from 'hono';
import type { WSContext } from 'hono/ws';
import type { WebSocket } from 'ws';
import type { WsEvent } from '../types.js';
import type { Logger } from '../logger.js';
import { createAgentGateway, type AgentGatewayHooks } from './agent/gateway.js';

export interface WsHub {
  /** Attach the ws server to the running HTTP server: injectWebSocket(server). */
  injectWebSocket: (server: Parameters<ReturnType<typeof createNodeWebSocket>['injectWebSocket']>[0]) => void;
  broadcast(event: WsEvent): void;
  clientCount: number;
}

export function createWsHub(app: Hono, log: Logger, hooks?: AgentGatewayHooks): WsHub {
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  // /agent — headless extension gateway (Agent UI console ↔ extension SW).
  // Shares the same WebSocketServer so a single injectWebSocket() covers both.
  createAgentGateway(app, log.child('agent'), upgradeWebSocket, hooks);
  const clients = new Set<WSContext<WebSocket>>();

  app.get('/ws', upgradeWebSocket((_c) => ({
    onOpen(_evt, ws) {
      clients.add(ws);
      log.info(`ws: client connected (${clients.size} total)`);
    },
    onClose(_evt, ws) {
      clients.delete(ws);
      log.info(`ws: client disconnected (${clients.size} total)`);
    },
    onError(evt) {
      log.warn(`ws: error: ${String(evt)}`);
    },
  })));

  return {
    injectWebSocket: (server) => injectWebSocket(server as never),
    broadcast(event) {
      const payload = JSON.stringify(event);
      for (const ws of clients) {
        try {
          ws.send(payload);
        } catch {
          clients.delete(ws); // dead socket
        }
      }
    },
    get clientCount() {
      return clients.size;
    },
  };
}
