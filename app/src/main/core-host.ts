/**
 * Core child-process host.
 *
 * Strategy: adopt an already-running healthy Core on 127.0.0.1:34567-34570
 * (the extension may have started it via tomihunt://); otherwise fork the
 * repo's `core/dist/index.js` with TOMI_AS_CHILD=1 so it never hijacks the
 * user's browser (the Agent UI owns first-run setup). Reports the resolved
 * REST base URL (core auto-shifts 34567→34570 when busy) to subscribers.
 */
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Candidate ports Core may pick (keep in sync with core/src/config.ts). */
const PORT_CANDIDATES = [34567, 34568, 34569, 34570];

export interface CoreState {
  kind: 'adopted' | 'forked' | 'missing' | 'stopped';
  /** REST base, e.g. http://127.0.0.1:34567. */
  base: string | null;
  reason?: string;
}

const configDir = process.env.TOMI_HOME ?? join(homedir(), '.tomi-job-hunt');
const logDir = join(configDir, 'logs');
mkdirSync(logDir, { recursive: true });
const logPath = join(logDir, 'app.log');

export function appLog(line: string): void {
  const ts = new Date().toISOString();
  try {
    appendFileSync(logPath, `[${ts}] ${line}\n`, 'utf8');
  } catch {
    // best-effort log file
  }
  console.log(`[tomi] ${line}`);
}

/**
 * Core dist location. Packaged: the pack script stages core/{dist,package.json,
 * node_modules} into resources/core (see scripts/pack.mjs + electron-builder.yml
 * extraResources). Dev: repo root = app/out/main + up 3.
 */
export function coreDistPath(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'core', 'dist', 'index.js');
  const repoRoot = resolve(__dirname, '..', '..', '..');
  return join(repoRoot, 'core', 'dist', 'index.js');
}

async function healthyBase(port: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 700);
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const body = (await resp.json()) as { ok?: boolean; provider?: string };
    return body.ok === true && typeof body.provider === 'string' ? `http://127.0.0.1:${port}` : null;
  } catch {
    return null;
  }
}

/** Returns the base of a running TomiHunt Core, or null. */
export async function discoverBase(): Promise<string | null> {
  for (const port of PORT_CANDIDATES) {
    const base = await healthyBase(port);
    if (base) return base;
  }
  return null;
}

export class CoreHost {
  private child: ChildProcess | null = null;
  private stopped = false;
  private attempts = 0;
  private listeners = new Set<(s: CoreState) => void>();
  private current: CoreState = { kind: 'stopped', base: null };

  get state(): CoreState {
    return this.current;
  }

  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: (s: CoreState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: CoreState): void {
    this.current = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        appLog(`core state listener error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.attempts = 0;
    const adopted = await discoverBase();
    if (adopted) {
      appLog(`adopted running core at ${adopted}`);
      this.emit({ kind: 'adopted', base: adopted });
      return;
    }
    this.spawn();
  }

  private spawn(): void {
    if (this.stopped) return;
    const dist = coreDistPath();
    if (!existsSync(dist)) {
      appLog(`core dist missing: ${dist}`);
      const reason = app.isPackaged
        ? 'core 组件缺失或损坏，请重新安装 TomiHunt Agent'
        : `core 未构建：请先运行 npm run build -w core\n（期待路径 ${dist}）`;
      this.emit({ kind: 'missing', base: null, reason });
      return;
    }
    // Fork with Electron acting as a plain Node runtime (no ELECTRON_RUN_AS_NODE
    // needed on the child because we set it explicitly here). Packaged machines
    // have no system Node, so process.execPath is the only reliable runtime.
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      TOMI_AS_CHILD: '1',
      TOMI_NO_OPEN_BROWSER: '1',
    };
    appLog(`forking core: ${process.execPath} ${dist}`);
    const child = spawn(process.execPath, [dist], { cwd: dirname(dist), env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout?.on('data', (d) => appLog(`core: ${String(d).trimEnd()}`));
    child.stderr?.on('data', (d) => appLog(`core-err: ${String(d).trimEnd()}`));
    child.on('error', (err) => appLog(`core spawn error: ${err.message}`));
    child.on('exit', (code) => {
      appLog(`core exited code=${code}`);
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.attempts += 1;
      if (this.attempts <= 3) {
        this.emit({ kind: 'stopped', base: null, reason: `core 异常退出（code ${code}）——${this.attempts}/3 重启` });
        setTimeout(() => this.spawn(), 1500);
      } else {
        this.emit({ kind: 'stopped', base: null, reason: `core 连续退出，已停止（code ${code}）` });
      }
    });
    void this.waitReady(30_000);
  }

  private async waitReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (!this.stopped && Date.now() - start < timeoutMs) {
      const base = await discoverBase();
      if (base) {
        this.attempts = 0;
        appLog(`core ready at ${base}`);
        this.emit({ kind: 'forked', base });
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!this.stopped) this.emit({ kind: 'stopped', base: null, reason: 'core 启动超时（30s）' });
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill();
    this.child = null;
  }
}
