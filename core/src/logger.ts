/**
 * Minimal leveled logger. All service logs go through here (never console.log
 * directly) so a file transport can be added later without touching callers.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly prefix: string = '',
  ) {}

  child(prefix: string): Logger {
    return new Logger(this.minLevel, this.prefix ? `${this.prefix} ${prefix}` : prefix);
  }

  debug(msg: string, extra?: unknown): void {
    this.log('debug', msg, extra);
  }

  info(msg: string, extra?: unknown): void {
    this.log('info', msg, extra);
  }

  warn(msg: string, extra?: unknown): void {
    this.log('warn', msg, extra);
  }

  error(msg: string, extra?: unknown): void {
    this.log('error', msg, extra);
  }

  private log(level: LogLevel, msg: string, extra?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const ts = new Date().toISOString();
    const head = `${ts} [${level.toUpperCase()}]${this.prefix ? ` ${this.prefix}` : ''}`;
    const line = extra === undefined ? `${head} ${msg}` : `${head} ${msg} ${formatExtra(extra)}`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }
}

function formatExtra(extra: unknown): string {
  try {
    return typeof extra === 'string' ? extra : JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}
