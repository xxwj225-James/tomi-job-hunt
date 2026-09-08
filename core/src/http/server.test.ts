import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { Logger } from '../logger.js';
import { JdStore } from '../jd/store.js';
import { registerRoutes, type RouteDeps } from './server.js';
import type { ChatProvider } from '../types.js';
import type { JdTags } from '../jd/schema.js';

const silentLog = new Logger('error', 'test');

const JD_BODY = {
  source: 'zhipin',
  url: 'https://www.zhipin.com/job_detail/a.html',
  title: '后端工程师',
  company: '甲厂',
  salaryText: '20-30K',
  requirements: '写 Java',
};

function jsonLines(dataDir: string): string[] {
  const file = join(dataDir, 'jds.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

interface ServerHarness {
  app: Hono;
  store: JdStore;
  dataDir: string;
  dir: string;
  broadcast: ReturnType<typeof vi.fn>;
  queueRun: ReturnType<typeof vi.fn>;
  usageCount: ReturnType<typeof vi.fn>;
}

function makeHarness(): ServerHarness {
  const dir = mkdtempSync(join(tmpdir(), 'tomi-srv-'));
  const dataDir = join(dir, 'data');
  const store = new JdStore(dataDir, silentLog);
  const broadcast = vi.fn();
  // Tag:true runs tagJdWithRetry through the queue — the fake never resolves so
  // no LLM provider is ever touched (assertions only cover the queued broadcast
  // + synchronous store save that happen before the async tagging completes).
  const queueRun = vi.fn(() => new Promise(() => {}));
  const usageCount = vi.fn();
  const app = new Hono();
  registerRoutes(app, {
    provider: { id: 'fake' } as unknown as ChatProvider,
    queue: {
      run: queueRun,
      get active() {
        return 0;
      },
      get pending() {
        return 0;
      },
    } as unknown as RouteDeps['queue'],
    log: silentLog,
    ws: { broadcast, injectWebSocket: vi.fn(), clientCount: 0 } as unknown as RouteDeps['ws'],
    store,
    configDir: dir,
    board: {} as unknown as RouteDeps['board'],
    feedback: {} as unknown as RouteDeps['feedback'],
    usage: { count: usageCount } as unknown as RouteDeps['usage'],
  });
  return { app, store, dataDir, dir, broadcast, queueRun, usageCount };
}

const harnesses: ServerHarness[] = [];
function track(h: ServerHarness): ServerHarness {
  harnesses.push(h);
  return h;
}

afterEach(() => {
  for (const h of harnesses.splice(0)) rmSync(h.dir, { recursive: true, force: true });
});

describe('POST /v1/jd/capture — tag:false silent 库 import (BOSS SPA browse)', () => {
  it('stores the JD without tagging: 200 {jobUid}, no queue job, no WS events, no tag field', async () => {
    const { app, store, dataDir, broadcast, queueRun, usageCount } = track(makeHarness());
    const res = await app.request('/v1/jd/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JD_BODY, tag: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobUid: string; taggingJobId?: string };
    expect(body.jobUid).toBeTruthy();
    expect(body.taggingJobId).toBeUndefined(); // no async tagging job

    const record = store.findByUid(body.jobUid);
    expect(record?.title).toBe(JD_BODY.title);
    expect(record?.tags).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain('"tag"'); // transport flag stripped

    expect(queueRun).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    expect(usageCount).toHaveBeenCalledTimes(1);
    expect(jsonLines(dataDir)).toHaveLength(1);
  });

  it('skips the append when a tagged record for the same jobUid already exists', async () => {
    const { app, store, dataDir, queueRun } = track(makeHarness());
    const first = await app.request('/v1/jd/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JD_BODY, tag: false }),
    });
    const { jobUid } = (await first.json()) as { jobUid: string };
    expect(jsonLines(dataDir)).toHaveLength(1);

    // Simulate Core tagging finishing for that record (the normal async path).
    const tags: JdTags = {
      techStack: ['Java'],
      yearsReq: '3-5',
      degreeReq: '本科',
      workHours: '弹性',
      riskFlags: [],
      summary: '写 Java 的后端岗位',
    };
    store.updateTags(jobUid, tags);
    expect(jsonLines(dataDir)).toHaveLength(2); // untagged line + tagged line

    // Re-browsing the SAME job (tag:false) must NOT append a third line.
    const again = await app.request('/v1/jd/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...JD_BODY, tag: false }),
    });
    expect(again.status).toBe(200);
    expect(jsonLines(dataDir)).toHaveLength(2);
    expect(store.findByUid(jobUid)?.tags).toBeDefined();
    expect(queueRun).not.toHaveBeenCalled();
  });
});

describe('POST /v1/jd/capture — default tag:true stays unchanged', () => {
  it('returns 202 with taggingJobId, queues the tagging job and broadcasts job/queued', async () => {
    const { app, store, broadcast, queueRun, usageCount } = track(makeHarness());
    const res = await app.request('/v1/jd/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(JD_BODY),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobUid: string; taggingJobId: string };
    expect(body.jobUid).toBeTruthy();
    expect(body.taggingJobId).toBeTruthy();

    expect(store.findByUid(body.jobUid)?.title).toBe(JD_BODY.title);
    expect(queueRun).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith({ type: 'job/queued', jobId: body.taggingJobId });
    expect(usageCount).toHaveBeenCalledTimes(1);
  });
});
