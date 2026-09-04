/**
 * Opt-in anonymous usage telemetry (DEFAULT OFF).
 *
 * Every counter is gated on consent: while OFF nothing is recorded and no file
 * is ever created — `count`/`markDaily` are hard no-ops. When the user opts in
 * from the Agent Settings panel, per-day feature counts accumulate in a
 * standalone `telemetry.json` and a background flush POSTs aggregate counts to
 * a collector URL. The payload is pure feature-name→count pairs — it never
 * contains resumes, JD text, chat content, or any content-bearing field.
 *
 * Days are flushed only after they close (UTC rollover moves them into
 * `pending`), so each (installId, day) is sent at most once and a collector can
 * append rather than sum. Writes are synchronous on purpose: core is a single
 * process and the counters are tiny.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../logger.js';

/** Default collector endpoint — mirrors the extension feedback collector host.
 *  Overridable via telemetry.json `collectorUrl` or env `TOMI_TELEMETRY_URL`
 *  (self-host / dev), see resolvedUrl(). */
export const USAGE_ENDPOINT = 'https://tomatovector.com/api/tomihunt-usage';

/** Env override for the collector URL — wins over the stored value. */
export const USAGE_URL_ENV = 'TOMI_TELEMETRY_URL';

const USAGE_FILE = 'telemetry.json';
const APP_ID = 'tomi-agent';
/** Flush cadence — mirrors the OTA version poller (index.ts). */
const FLUSH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Console-facing state (installId deliberately excluded — stays on disk). */
export interface UsageState {
  consent: boolean;
  collectorUrl: string;
  day: string;
  events: Record<string, number>;
}

/** On-disk shape of telemetry.json. */
interface StoredState {
  installId?: string;
  consent: boolean;
  collectorUrl?: string;
  appVersion?: string;
  lastFlushAt?: string;
  /** Current (open) UTC day being counted. */
  day: string;
  events: Record<string, number>;
  /** Closed days awaiting a successful flush — { 'YYYY-MM-DD': counts }. */
  pending: Record<string, Record<string, number>>;
}

export interface UsageTelemetryOpts {
  configDir: string;
  log: Logger;
  /** Injectable clock for deterministic rollover tests. */
  now?: () => Date;
  /** Injectable fetch for closed-loop flush tests. */
  fetchImpl?: typeof fetch;
  /** Dev/test collector override (lowest precedence after env + stored). */
  collectorUrl?: string;
  /** core package.json version, read by index.ts at boot. */
  coreVersion?: string;
}

function isCountMap(v: unknown): v is Record<string, number> {
  return (
    typeof v === 'object' &&
    v !== null &&
    Object.values(v).every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
  );
}

function isPendingMap(v: unknown): v is Record<string, Record<string, number>> {
  return typeof v === 'object' && v !== null && Object.values(v).every(isCountMap);
}

export class UsageTelemetry {
  private readonly file: string;
  private readonly now: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly log: Logger;
  private readonly coreVersion?: string;
  private readonly defaultUrl: string;

  private state: StoredState;
  /** True once telemetry.json exists (or was written) — keeps OFF-mode disk-clean. */
  private onDisk = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against overlapping flush() runs (interval + shutdown racing). */
  private flushing = false;

  constructor(opts: UsageTelemetryOpts) {
    this.file = join(opts.configDir, USAGE_FILE);
    this.log = opts.log;
    this.now = opts.now ?? (() => new Date());
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.coreVersion = opts.coreVersion;
    this.defaultUrl = opts.collectorUrl ?? USAGE_ENDPOINT;
    this.state = this.load();
  }

  /** Read telemetry.json tolerantly — a malformed file degrades to consent OFF. */
  private load(): StoredState {
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
      if (typeof j !== 'object' || j === null) throw new Error('bad file');
      const day =
        typeof j.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.day) ? j.day : this.today();
      this.onDisk = true;
      return {
        installId: typeof j.installId === 'string' ? j.installId : undefined,
        consent: j.consent === true,
        collectorUrl: typeof j.collectorUrl === 'string' ? j.collectorUrl : undefined,
        appVersion: typeof j.appVersion === 'string' ? j.appVersion : undefined,
        lastFlushAt: typeof j.lastFlushAt === 'string' ? j.lastFlushAt : undefined,
        day,
        events: isCountMap(j.events) ? j.events : {},
        pending: isPendingMap(j.pending) ? j.pending : {},
      };
    } catch {
      // No file yet or unreadable — start clean (consent OFF). NEVER treat a
      // corrupt file as a reason to begin collecting.
      return { consent: false, day: this.today(), events: {}, pending: {} };
    }
  }

  private today(): string {
    return this.dayOf(this.now());
  }

  /** UTC date string — same convention as the watchdog state. */
  private dayOf(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Move a finished UTC day's counters into `pending` when the day rolled. */
  private rolloverIfNeeded(): void {
    const today = this.today();
    if (this.state.day === today) return;
    const finished = this.state.events;
    const oldDay = this.state.day;
    this.state.day = today;
    this.state.events = {};
    if (oldDay && Object.keys(finished).length > 0) {
      this.state.pending[oldDay] = finished;
    }
  }

  /** Persist state. Never creates the file while OFF. */
  private save(): void {
    if (!this.state.consent && !this.onDisk) return;
    try {
      writeFileSync(this.file, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      this.onDisk = true;
    } catch (err) {
      this.log.warn(`telemetry: could not persist state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Collector URL precedence: env override → stored value → default/dev URL. */
  private resolvedUrl(): string {
    const env = process.env[USAGE_URL_ENV];
    if (env && env.trim()) return env.trim();
    return this.state.collectorUrl ?? this.defaultUrl;
  }

  /** Public state for the Settings toggle (no installId, no pending). */
  getState(): UsageState {
    return {
      consent: this.state.consent,
      collectorUrl: this.resolvedUrl(),
      day: this.state.day,
      events: { ...this.state.events },
    };
  }

  /** Record one feature use. Hard no-op while consent is OFF. */
  count(name: string): void {
    if (!this.state.consent) return;
    this.rolloverIfNeeded();
    const ev = this.state.events;
    ev[name] = (ev[name] ?? 0) + 1;
    this.save();
  }

  /** Daily presence marker — at most 1/day per name, idempotent across reloads
   *  and the extension SW's ~30s reconnects. Hard no-op while consent is OFF. */
  markDaily(name: string): void {
    if (!this.state.consent) return;
    this.rolloverIfNeeded();
    const ev = this.state.events;
    if (!ev[name]) ev[name] = 1;
    this.save();
  }

  /** Opt-in/out. ON lazily creates the file + installId and starts flushing;
   *  OFF clears every counter (withdrawal) and stops the interval. */
  setConsent(on: boolean): void {
    if (on) {
      this.state.consent = true;
      if (!this.state.installId) this.state.installId = randomUUID();
      this.save();
      this.start();
    } else {
      const had = this.state.consent || Object.keys(this.state.events).length > 0 ||
        Object.keys(this.state.pending).length > 0;
      this.stop();
      this.state.consent = false;
      this.state.events = {};
      this.state.pending = {};
      if (had || this.onDisk) this.save();
    }
  }

  /** Override the collector URL. Empty string resets to default. */
  setCollectorUrl(url: string): void {
    const trimmed = url.trim();
    if (trimmed) this.state.collectorUrl = trimmed;
    else this.state.collectorUrl = undefined;
    if (this.state.consent || this.onDisk) this.save();
  }

  /** Attach the real desktop app version to future payloads. */
  setAppVersion(v: string): void {
    const trimmed = v.trim();
    if (!trimmed || trimmed === this.state.appVersion) return;
    this.state.appVersion = trimmed;
    if (this.state.consent || this.onDisk) this.save();
  }

  /** Upload all closed (pending) days. A day is cleared only on a 2xx — a
   *  failure leaves it pending for the next flush (startup/stale/shutdown). */
  async flush(): Promise<boolean> {
    if (!this.state.consent) return false;
    if (this.flushing) return true; // an in-flight flush covers this call
    this.flushing = true;
    try {
      this.rolloverIfNeeded();
      const days = Object.keys(this.state.pending).sort();
      if (days.length === 0) return true;
      let allOk = true;
      for (const day of days) {
        const events = this.state.pending[day];
        if (!events) continue; // key vanished between list and read — nothing to send
        if (await this.postDay(day, events)) {
          delete this.state.pending[day];
          this.state.lastFlushAt = this.now().toISOString();
          this.save();
          this.log.debug(`telemetry: flushed ${day}`);
        } else {
          allOk = false;
        }
      }
      return allOk;
    } finally {
      this.flushing = false;
    }
  }

  /** Startup catch-up: if consent is ON and any closed day is still pending,
   *  hand it to the collector without blocking boot. */
  flushStaleIfAny(): void {
    if (!this.state.consent) return;
    this.rolloverIfNeeded();
    if (Object.keys(this.state.pending).length === 0) return;
    void this.flush();
  }

  /** Start the periodic flusher. Only runs while consent is ON. */
  start(intervalMs: number = FLUSH_INTERVAL_MS): void {
    if (!this.state.consent || this.timer) return;
    this.timer = setInterval(() => void this.flush(), intervalMs);
    this.timer.unref();
  }

  dispose(): void {
    this.stop();
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async postDay(day: string, events: Record<string, number>): Promise<boolean> {
    const payload: Record<string, unknown> = {
      installId: this.state.installId,
      day,
      platform: process.platform,
      app: APP_ID,
      coreVersion: this.coreVersion,
      events,
    };
    if (this.state.appVersion) payload.appVersion = this.state.appVersion;
    try {
      const res = await this.fetchImpl(this.resolvedUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res && res.ok) return true;
      this.log.warn(`telemetry: collector rejected (status ${res?.status ?? 'none'}) — retrying later`);
      return false;
    } catch (err) {
      this.log.warn(
        `telemetry: collector unreachable: ${err instanceof Error ? err.message : String(err)} — retrying later`,
      );
      return false;
    }
  }
}
