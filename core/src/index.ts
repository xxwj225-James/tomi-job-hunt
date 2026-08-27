/**
 * Tomi-Job-Hunt Core service entry point.
 *
 *   config → logger → provider → queue → HTTP + WS (127.0.0.1 only)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PORT_RETRIES, loadConfig, loadDotEnv, readConfigFile } from './config.js';
import { Logger } from './logger.js';
import { TaskQueue } from './queue.js';
import { createChatProvider, createChatProviderSafe } from './llm/factory.js';
import { createWsHub } from './ws/server.js';
import { registerRoutes } from './http/server.js';
import { registerSetupRoutes } from './http/setup.js';
import { JdStore } from './jd/store.js';
import { Board } from './jd/board.js';
import { hasClaudeCredentials } from './llm/claude-code.js';
import { buildUpdateCheck, fetchRemoteVersion, type UpdateCheck } from './version.js';
import type { ChatProvider, LLMConfig } from './types.js';

/** Repo-hosted version manifest — overridable for mirrors/self-hosting. */
const VERSION_URL =
  process.env.TOMI_VERSION_URL ??
  'https://raw.githubusercontent.com/xxwj225-James/tomi-job-hunt/main/version.json';

const CURRENT_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

/** True when the port is free to bind on 127.0.0.1. */
export function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Resolves the listen port. A user-configured port is used verbatim (busy =
 * loud failure — they asked for it). Otherwise probe DEFAULT_PORT..+3 and
 * record the actual port in core-port.json so launchers/watchers can find it.
 */
export async function resolvePort(
  configDir: string,
  cfgPort: number,
  log: Logger,
): Promise<number> {
  const raw = readConfigFile(configDir);
  const configured = Boolean(process.env.TOMI_PORT || raw.port);
  if (configured) return cfgPort;
  for (let i = 0; i < PORT_RETRIES; i += 1) {
    const port = cfgPort + i;
    if (await probePort(port)) {
      if (i > 0) log.info(`port ${cfgPort} busy — auto-selected ${port}`);
      try {
        writeFileSync(
          join(configDir, 'core-port.json'),
          JSON.stringify({ port, updatedAt: new Date().toISOString() }),
          'utf8',
        );
      } catch {
        // port.json is best-effort
      }
      return port;
    }
  }
  log.warn(`all candidate ports (${cfgPort}-${cfgPort + PORT_RETRIES - 1}) busy — trying ${cfgPort} anyway`);
  return cfgPort;
}

async function main(): Promise<void> {
  loadDotEnv();
  const cfg = loadConfig();
  const log = new Logger(cfg.logLevel, 'core');
  const port = await resolvePort(cfg.configDir, cfg.port, log);

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

  // OTA: non-blocking version check at startup + every 6h. Never blocks boot.
  const updateRef: { current: UpdateCheck } = {
    current: buildUpdateCheck(CURRENT_VERSION, null),
  };
  const pollVersion = async (): Promise<void> => {
    const remote = await fetchRemoteVersion(VERSION_URL);
    updateRef.current = buildUpdateCheck(CURRENT_VERSION, remote);
    if (updateRef.current.updateAvailable) {
      log.info(`update available: ${remote!.version} — ${remote!.releaseUrl ?? '(see version.json)'}`);
    }
  };
  void pollVersion();
  setInterval(() => void pollVersion(), 6 * 3600 * 1000).unref();

  const app = new Hono();
  const ws = createWsHub(app, log.child('ws'));
  registerRoutes(app, {
    provider: providerView,
    queue,
    log,
    ws,
    store,
    configDir: cfg.configDir,
    board,
    update: () => updateRef.current,
  });
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
      port,
      hostname: '127.0.0.1',
    },
    (info) => {
      log.info(
        `listening on http://${info.address}:${info.port} ` +
          `(provider: ${cfg.llm.provider}, model: ${cfg.llm.model ?? 'default'}, concurrency: ${cfg.llm.concurrency})`,
      );
      maybeOpenSetupBrowser(cfg.configDir, cfg.llm, log, port);
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
function maybeOpenSetupBrowser(configDir: string, llm: LLMConfig, log: Logger, port: number): void {
  if (process.env.TOMI_NO_OPEN_BROWSER === '1') return;
  const raw = readConfigFile(configDir);
  const claudeCodeReady = llm.provider === 'claude-code' && hasClaudeCredentials();
  const hasKey = Boolean(raw.apiKey) || Boolean(llm.apiKey) || claudeCodeReady;
  if (hasKey) return;
  const url = `http://127.0.0.1:${port}/setup`;
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
