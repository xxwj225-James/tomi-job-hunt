/**
 * Tomi-Job-Hunt Core service entry point.
 *
 *   config → logger → provider → queue → HTTP + WS (127.0.0.1 only)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig, loadDotEnv } from './config.js';
import { Logger } from './logger.js';
import { TaskQueue } from './queue.js';
import { createChatProvider } from './llm/factory.js';
import { createWsHub } from './ws/server.js';
import { registerRoutes } from './http/server.js';

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig();
  const log = new Logger(cfg.logLevel, 'core');

  // Dedicated work dir so the Claude Code CLI subprocess never reads the
  // host user's settings/CLAUDE.md (privacy + isolation).
  const workDir = join(cfg.configDir, 'work');
  mkdirSync(workDir, { recursive: true });

  const provider = createChatProvider(cfg.llm, log.child('llm'), workDir);
  const queue = new TaskQueue(cfg.llm.concurrency, log.child('queue'));

  const app = new Hono();
  const ws = createWsHub(app, log.child('ws'));
  registerRoutes(app, { provider, queue, log, ws });

  const server = serve(
    {
      fetch: app.fetch,
      port: cfg.port,
      hostname: '127.0.0.1',
    },
    (info) => {
      log.info(
        `listening on http://${info.address}:${info.port} ` +
          `(provider: ${cfg.llm.provider}, model: ${cfg.llm.model ?? 'default'}, concurrency: ${cfg.llm.concurrency})`,
      );
    },
  );
  ws.injectWebSocket(server);

  const shutdown = (): void => {
    log.info('shutting down...');
    server.close(() => process.exit(0));
    // Force-exit if sockets keep the loop alive.
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
