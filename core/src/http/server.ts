/**
 * HTTP routes. Local-only API consumed by the browser extension (Phase 1+).
 *
 *   GET  /health                liveness + queue stats
 *   POST /v1/chat               run a chat request through the queue
 *   POST /v1/jd/capture         store a JD, tag it asynchronously (202)
 *   POST /v1/jd/tag             tag a JD synchronously (manual/debug)
 *   GET  /v1/jd                 recent JD records
 *   GET  /v1/jd/search          tag-based coarse filter
 *   GET  /v1/jd/:jobUid         one record + its reports
 *   POST /v1/jd/:jobUid/report  add a sanitized structured report
 *   GET  /ws                    WebSocket job lifecycle events (ws/server.ts)
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { ChatProvider, ChatRequest } from '../types.js';
import type { TaskQueue } from '../queue.js';
import type { Logger } from '../logger.js';
import { ChatProviderError } from '../llm/chat-provider.js';
import type { WsHub } from '../ws/server.js';
import {
  computeJobUid,
  jdCaptureInputSchema,
  jobReportInputSchema,
  type JdRecord,
} from '../jd/schema.js';
import { tagJdWithRetry } from '../jd/tagger.js';
import { sanitizeReportNote } from '../jd/sanitize.js';
import type { JdStore } from '../jd/store.js';

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      }),
    )
    .min(1),
  model: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export interface RouteDeps {
  provider: ChatProvider;
  queue: TaskQueue;
  log: Logger;
  ws: WsHub;
  store: JdStore;
}

export function registerRoutes(app: Hono, deps: RouteDeps): void {
  // Permissive CORS: the service binds 127.0.0.1 only, and MV3 extensions
  // fetch from chrome-extension:// origins.
  app.use('*', cors());

  app.get('/health', (c) =>
    c.json({
      ok: true,
      provider: deps.provider.id,
      queue: { active: deps.queue.active, pending: deps.queue.pending },
      wsClients: deps.ws.clientCount,
    }),
  );

  app.post('/v1/chat', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const req: ChatRequest = parsed.data;
    const jobId = randomUUID();
    const jobLog = deps.log.child(`job:${jobId.slice(0, 8)}`);
    jobLog.info(`chat: ${req.messages.length} messages, model=${req.model ?? 'default'}`);

    deps.ws.broadcast({ type: 'job/queued', jobId });
    try {
      const result = await deps.queue.run(async () => {
        deps.ws.broadcast({ type: 'job/started', jobId });
        return await deps.provider.chat(req);
      });
      jobLog.info(`chat: done (${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens)`);
      deps.ws.broadcast({ type: 'job/done', jobId, result });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      jobLog.error(`chat: failed: ${message}`);
      deps.ws.broadcast({ type: 'job/error', jobId, message });
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message, jobId }, status);
    }
  });

  // --- JD capture & tagging ---

  app.post('/v1/jd/capture', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = jdCaptureInputSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const input = parsed.data;
    const jobUid = computeJobUid(input.company, input.title);
    const record: JdRecord = { ...input, jobUid, capturedAt: new Date().toISOString() };
    deps.store.save(record);
    deps.log.info(`jd: captured ${jobUid} (${input.company} — ${input.title})`);

    // Tag asynchronously through the queue; result arrives via WS 'jd/tagged'.
    const taggingJobId = randomUUID();
    deps.ws.broadcast({ type: 'job/queued', jobId: taggingJobId });
    void deps.queue
      .run(async () => {
        deps.ws.broadcast({ type: 'job/started', jobId: taggingJobId });
        const tags = await tagJdWithRetry(deps.provider, input, deps.log.child(`tag:${taggingJobId.slice(0, 8)}`));
        deps.store.updateTags(jobUid, tags);
        return tags;
      })
      .then((tags) => {
        deps.ws.broadcast({ type: 'jd/tagged', jobId: taggingJobId, jobUid, tags });
        deps.log.info(`jd: tagged ${jobUid} (${tags.techStack.length} tech, ${tags.riskFlags.length} risks)`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.log.warn(`jd: tagging failed for ${jobUid}: ${message}`);
        deps.ws.broadcast({ type: 'jd/tagged', jobId: taggingJobId, jobUid, tags: null, error: message });
      });

    return c.json({ jobUid, taggingJobId }, 202);
  });

  app.post('/v1/jd/tag', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = jdCaptureInputSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    try {
      const tags = await tagJdWithRetry(deps.provider, parsed.data, deps.log);
      return c.json({ tags });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.log.error(`jd: manual tagging failed: ${message}`);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.get('/v1/jd', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 100);
    return c.json({ total: deps.store.size, records: deps.store.listRecent(limit) });
  });

  app.get('/v1/jd/search', (c) => {
    const tagsParam = c.req.query('tags');
    const riskParam = c.req.query('risk');
    const filters = {
      techStack: tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      riskFlags: riskParam ? riskParam.split(',').map((r) => r.trim()).filter(Boolean) : undefined,
      workHours: c.req.query('workHours'),
    };
    const matches = deps.store.searchByTags({
      techStack: filters.techStack ?? [],
      riskFlags: filters.riskFlags ?? [],
      workHours: filters.workHours,
    });
    return c.json({ count: matches.length, records: matches });
  });

  app.get('/v1/jd/:jobUid', (c) => {
    const record = deps.store.findByUid(c.req.param('jobUid'));
    if (!record) return c.json({ error: 'Not found' }, 404);
    return c.json({ record, reports: deps.store.getReports(record.jobUid) });
  });

  app.post('/v1/jd/:jobUid/report', async (c) => {
    const jobUid = c.req.param('jobUid');
    if (!deps.store.findByUid(jobUid)) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json().catch(() => null);
    const parsed = jobReportInputSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const input = parsed.data;
    // Compliance moat: PII masking + neutralization before anything is stored.
    const note = input.note === undefined ? undefined : sanitizeReportNote(input.note);
    const report = deps.store.addReport(jobUid, {
      type: input.type,
      note,
      evidenceHash: input.evidenceHash,
    });
    deps.log.info(`jd: report ${report.type} added to ${jobUid}`);
    return c.json(report, 201);
  });
}
