import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../logger.js';
import { USAGE_URL_ENV, UsageTelemetry } from './telemetry.js';

const DAY1 = new Date('2026-09-03T12:00:00Z');
const DAY2 = new Date('2026-09-04T09:00:00Z');

/** Fixed log level keeps flush-failure warnings off the test output. */
const log = new Logger('error');

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

/** Injectable collector. statuses cycles; last entry repeats. */
function makeCollector(statuses: number[] = [200]): { posts: Posted[]; fetchImpl: typeof fetch } {
  const posts: Posted[] = [];
  let i = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    posts.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '')) as Record<string, unknown>,
    });
    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;
    return new Response('{}', { status });
  };
  return { posts, fetchImpl };
}

function json(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'telemetry.json'), 'utf8')) as Record<string, unknown>;
}

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tomi-telemetry-'));
  delete process.env[USAGE_URL_ENV];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env[USAGE_URL_ENV];
});

function make(now: () => Date = () => DAY1, over: Partial<{ fetchImpl: typeof fetch; coreVersion: string; collectorUrl: string }> = {}) {
  return new UsageTelemetry({
    configDir: dir,
    log,
    now,
    fetchImpl: over.fetchImpl ?? (async () => new Response('{}', { status: 200 })),
    coreVersion: over.coreVersion ?? '0.1.0-test',
    collectorUrl: over.collectorUrl,
  });
}

describe('telemetry OFF by default', () => {
  it('count/markDaily are hard no-ops and no file is ever created', async () => {
    const { fetchImpl, posts } = makeCollector();
    const t = make(() => DAY1, { fetchImpl });
    expect(existsSync(join(dir, 'telemetry.json'))).toBe(false);

    t.count('greeting');
    t.markDaily('app_start');
    t.setConsent(false); // never-consented off toggle must not create a file

    const s = t.getState();
    expect(s.consent).toBe(false);
    expect(s.events).toEqual({});
    expect(existsSync(join(dir, 'telemetry.json'))).toBe(false);
    expect(await t.flush()).toBe(false);
    expect(posts).toHaveLength(0); // zero outbound requests while OFF
  });
});

describe('opt-in persists counts', () => {
  it('setConsent(true) creates installId and counts land on disk', () => {
    const t = make();
    t.setConsent(true);
    expect(existsSync(join(dir, 'telemetry.json'))).toBe(true);

    t.count('greeting');
    t.count('greeting');
    t.count('match');

    // Public state exposes counts but never the installId.
    const s = t.getState();
    expect(s.consent).toBe(true);
    expect(s.day).toBe('2026-09-03');
    expect(s.events).toEqual({ greeting: 2, match: 1 });
    expect('installId' in s).toBe(false);

    // On-disk state has the identity and the counters.
    const onDisk = json(dir);
    expect(typeof onDisk.installId).toBe('string');
    expect(String(onDisk.installId)).toHaveLength(36);
    expect(onDisk.consent).toBe(true);
    expect(onDisk.events).toEqual({ greeting: 2, match: 1 });
  });
});

describe('UTC day rollover', () => {
  it('closes the finished day into pending and flushes it', async () => {
    const clock = { value: DAY1 };
    const { fetchImpl, posts } = makeCollector([200]);
    const t = make(() => clock.value, { fetchImpl });
    t.setConsent(true);
    t.count('greeting');
    t.count('jd_capture');

    clock.value = DAY2;
    t.count('match'); // rollover: DAY1 closes

    const s = t.getState();
    expect(s.day).toBe('2026-09-04');
    expect(s.events).toEqual({ match: 1 });

    expect(await t.flush()).toBe(true);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.day).toBe('2026-09-03');
    expect(posts[0]!.body.events).toEqual({ greeting: 1, jd_capture: 1 });
  });
});

describe('markDaily idempotence + reload', () => {
  it('caps at one per day and stays capped after a reload', () => {
    const t = make();
    t.setConsent(true);
    t.markDaily('app_start');
    t.markDaily('app_start'); // SW reconnects must not double count
    expect(t.getState().events).toEqual({ app_start: 1 });

    // Simulate a core restart — counts and consent load from disk.
    const t2 = make();
    expect(t2.getState().consent).toBe(true);
    expect(t2.getState().events).toEqual({ app_start: 1 });
    t2.markDaily('app_start');
    t2.count('greeting');
    expect(t2.getState().events).toEqual({ app_start: 1, greeting: 1 });
  });
});

describe('setConsent(false) withdraws', () => {
  it('clears every counter and stops recording', () => {
    const t = make();
    t.setConsent(true);
    t.count('greeting');
    expect(json(dir).events).toEqual({ greeting: 1 });

    t.setConsent(false);
    expect(t.getState().consent).toBe(false);
    expect(t.getState().events).toEqual({});
    expect(json(dir).consent).toBe(false);
    expect(json(dir).events).toEqual({});

    t.count('greeting'); // after withdrawal: hard no-op
    expect(t.getState().events).toEqual({});
  });
});

describe('flush payload + clearing rules', () => {
  it('sends the exact aggregate shape and clears only on 2xx', async () => {
    const clock = { value: DAY1 };
    const { fetchImpl, posts } = makeCollector([200]);
    const t = make(() => clock.value, { fetchImpl });
    t.setConsent(true);
    t.setAppVersion('1.2.3');
    t.count('reply');
    t.count('board_add');
    clock.value = DAY2;
    t.count('mock_turn'); // close DAY1

    expect(await t.flush()).toBe(true);

    expect(posts).toHaveLength(1);
    const body = posts[0]!.body;
    expect(typeof body.installId).toBe('string');
    expect(body.day).toBe('2026-09-03');
    expect(body.platform).toBe(process.platform);
    expect(body.app).toBe('tomi-agent');
    expect(body.appVersion).toBe('1.2.3');
    expect(body.coreVersion).toBe('0.1.0-test');
    expect(body.events).toEqual({ reply: 1, board_add: 1 });

    // Cleared from disk, flushed timestamp recorded.
    const onDisk = json(dir);
    expect(onDisk.pending).toEqual({});
    expect(typeof onDisk.lastFlushAt).toBe('string');
  });

  it('keeps the day pending when the collector fails, then clears on retry', async () => {
    const clock = { value: DAY1 };
    const { fetchImpl, posts } = makeCollector([500, 200]);
    const t = make(() => clock.value, { fetchImpl });
    t.setConsent(true);
    t.count('greeting');
    clock.value = DAY2;
    t.count('match');

    expect(await t.flush()).toBe(false); // collector rejected
    expect(posts).toHaveLength(1);
    expect(json(dir).pending).toHaveProperty('2026-09-03'); // nothing lost

    expect(await t.flush()).toBe(true); // retry succeeds
    expect(json(dir).pending).toEqual({});
  });

  it('does not fail when there is nothing to flush', async () => {
    const t = make();
    t.setConsent(true);
    expect(await t.flush()).toBe(true);
  });
});

describe('malformed file degrades safely', () => {
  it('treats unreadable JSON as fresh consent-OFF state and can still opt in', () => {
    writeFileSync(join(dir, 'telemetry.json'), 'not-json{{', 'utf8');
    const t = make();
    expect(t.getState().consent).toBe(false);
    t.count('greeting'); // no throw, no recording
    expect(t.getState().events).toEqual({});

    t.setConsent(true); // opts in cleanly, overwriting the corrupt file
    expect(typeof json(dir).installId).toBe('string');
    expect(json(dir).consent).toBe(true);
  });

  it('tolerates wrong event shapes but keeps a valid consent flag', () => {
    writeFileSync(
      join(dir, 'telemetry.json'),
      JSON.stringify({
        installId: 'abc-123',
        consent: true,
        day: 'not-a-date',
        events: { greeting: 'oops' },
        pending: { '2026-09-03': { match: 1 } },
      }),
      'utf8',
    );
    const t = make();
    const s = t.getState();
    expect(s.consent).toBe(true);
    expect(s.day).toBe('2026-09-03'); // invalid stored day replaced by today
    expect(s.events).toEqual({});
    t.count('greeting');
    expect(t.getState().events).toEqual({ greeting: 1 });
  });
});
