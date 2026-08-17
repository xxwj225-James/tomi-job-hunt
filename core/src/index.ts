/**
 * Tomi-Job-Hunt Core service entry point.
 *
 *   config → logger → provider → queue → HTTP + WS (127.0.0.1 only)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig, loadDotEnv, readConfigFile } from './config.js';
import { Logger } from './logger.js';
import { TaskQueue } from './queue.js';
import { createChatProvider, createChatProviderSafe } from './llm/factory.js';
import { createWsHub } from './ws/server.js';
import { registerRoutes } from './http/server.js';
import { registerSetupRoutes } from './http/setup.js';
import { JdStore } from './jd/store.js';
import { Board } from './jd/board.js';
import { hasClaudeCredentials } from './llm/claude-code.js';
import type { ChatProvider, LLMConfig } from './types.js';

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig();
  const log = new Logger(cfg.logLevel, 'core');

  // Dedicated work dir so the Claude Code CLI subprocess never reads the
  // host user's settings/CLAUDE.md (privacy + isolation).
  const workDir = join(cfg.configDir, 'work');
  mkdirSync(workDir, { recursive: true });

  // Mutable provider reference: the /setup wizard swaps .current on save so
  // config changes apply without restarting the service. Safe creation keeps
  // the service up (stub provider) when nothing is configured yet, so the
  // first-run setup wizard can actually be reached.
  const providerRef: { current: ChatProvider } = {
    current: createChatProviderSafe(cfg.llm, log.child('llm'), workDir),
  };
  const providerView: ChatProvider = {
    get id() {
      return providerRef.current.id;
    },
    chat: (req) => providerRef.current.chat(req),
    chatStream: (req) => providerRef.current.chatStream(req),
  };

  const queue = new TaskQueue(cfg.llm.concurrency, log.child('queue'));
  const store = new JdStore(join(cfg.configDir, 'data'), log.child('store'));
  const board = new Board(cfg.configDir, log.child('board'));

  const app = new Hono();
  const ws = createWsHub(app, log.child('ws'));
  registerRoutes(app, { provider: providerView, queue, log, ws, store, configDir: cfg.configDir, board });
  registerSetupRoutes(app, {
    configDir: cfg.configDir,
    log: log.child('setup'),
    workDir,
    reloadProvider: (llm: LLMConfig) => {
      providerRef.current = createChatProviderSafe(llm, log.child('llm'), workDir);
      log.info(`llm: provider hot-reloaded (${llm.provider}, ${llm.model ?? 'default'})`);
    },
    createProvider: createChatProvider,
  });

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
      maybeOpenSetupBrowser(cfg.configDir, cfg.llm, log);
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

/**
 * First-run UX: when no LLM credentials are configured yet, open the local
 * /setup wizard in the default browser so the user never has to touch a
 * terminal or a config file. Skipped when a key exists, claude-code
 * credentials are present, or TOMI_NO_OPEN_BROWSER=1.
 */
function maybeOpenSetupBrowser(configDir: string, llm: LLMConfig, log: Logger): void {
  if (process.env.TOMI_NO_OPEN_BROWSER === '1') return;
  const raw = readConfigFile(configDir);
  const claudeCodeReady = llm.provider === 'claude-code' && hasClaudeCredentials();
  const hasKey = Boolean(raw.apiKey) || Boolean(llm.apiKey) || claudeCodeReady;
  if (hasKey) return;
  const url = `http://127.0.0.1:${process.env.TOMI_PORT ?? 3000}/setup`;
  log.info(`no LLM configured — opening setup wizard: ${url}`);
  try {
    const cmd =
      process.platform === 'win32'
        ? { file: 'cmd', args: ['/c', 'start', '', url] }
        : process.platform === 'darwin'
          ? { file: 'open', args: [url] }
          : { file: 'xdg-open', args: [url] };
    spawn(cmd.file, cmd.args, { stdio: 'ignore', detached: true }).unref();
  } catch (err) {
    log.warn(`could not open browser automatically: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
