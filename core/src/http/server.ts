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
import { greetJd } from '../jd/greeting.js';
import { loadResumeFile } from '../jd/resume-files.js';
import { scoreJd } from '../jd/match.js';
import { semanticSearch } from '../jd/semantic-search.js';
import { mdToHtml, tailorResume } from '../jd/tailor.js';
import { interviewPrep } from '../jd/interview.js';
import { Board, BOARD_STATUSES } from '../jd/board.js';
import { draftColdEmail, huntCompanies } from '../hunt/reverse.js';
import type { UpdateCheck } from '../version.js';
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
  temperature: z.number().min(0).max(2).optional(),
});

export interface RouteDeps {
  provider: ChatProvider;
  queue: TaskQueue;
  log: Logger;
  ws: WsHub;
  store: JdStore;
  /** Config dir (~/.tomi-job-hunt) — resume files / board.md live here. */
  configDir: string;
  board: Board;
  /** OTA update check accessor (refreshed by the version-check poller). */
  update?: () => UpdateCheck;
}

const boardAddSchema = z.object({
  status: z.enum(BOARD_STATUSES),
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  url: z.string().max(500).default(''),
  note: z.string().max(200).optional(),
});

const huntCompaniesSchema = z.object({
  skills: z.array(z.string().min(1).max(100)).min(1).max(20),
  cities: z.array(z.string().min(1).max(50)).max(10).optional(),
  count: z.number().int().min(5).max(50).default(20),
});

const coldEmailSchema = z.object({
  company: z.string().min(1).max(100),
  skills: z.array(z.string().min(1).max(100)).min(1).max(20),
  context: z.string().max(2000).optional(),
  resume: z.string().optional(),
});

const greetingRequestSchema = z.object({
  jd: z.object({
    title: z.string().min(1),
    company: z.string().min(1),
    salaryText: z.string().default(''),
    requirements: z.string().default(''),
    hrName: z.string().optional(),
  }),
  resume: z.string().optional(),
});

const jdWithResumeSchema = z.object({
  jd: z.object({
    title: z.string().min(1),
    company: z.string().min(1),
    salaryText: z.string().default(''),
    requirements: z.string().default(''),
    hrName: z.string().optional(),
  }),
  resume: z.string().optional(),
});

const semanticSearchSchema = z.object({
  query: z.string().min(2).max(200),
});

const exportSchema = z.object({
  tailoredMd: z.string().min(1),
  format: z.enum(['md', 'doc']).default('md'),
  jdTitle: z.string().optional(),
});

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
      update: deps.update?.(),
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

  // --- Greeting pitch generation ---

  app.post('/v1/greeting', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = greetingRequestSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { jd, resume } = parsed.data;
    // Prefer the local resume file (md/txt/docx/pdf) unless the caller
    // passed an explicit resume.
    const effectiveResume = resume ?? (await loadResumeFile(deps.configDir, deps.log));
    const jobId = randomUUID();
    deps.ws.broadcast({ type: 'job/queued', jobId });
    try {
      const result = await deps.queue.run(async () => {
        deps.ws.broadcast({ type: 'job/started', jobId });
        return await greetJd(deps.provider, jd, effectiveResume, deps.log.child(`greet:${jobId.slice(0, 8)}`));
      });
      deps.ws.broadcast({ type: 'job/done', jobId, result });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.ws.broadcast({ type: 'job/error', jobId, message });
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message, jobId }, status);
    }
  });

  // --- Phase 2: match scoring / semantic search / resume tailoring ---

  app.post('/v1/match', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = jdWithResumeSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { jd, resume } = parsed.data;
    const effectiveResume = resume ?? (await loadResumeFile(deps.configDir, deps.log));
    try {
      const result = await deps.queue.run(() =>
        scoreJd(deps.provider, jd, effectiveResume, deps.log.child('match')),
      );
      deps.log.info(`match: score=${result.score} verdict=${result.verdict} (${jd.company} — ${jd.title})`);
      return c.json({
        ...result,
        warning: effectiveResume
          ? undefined
          : '未配置简历（~/.tomi-job-hunt/resume.md / resume.docx / resume.pdf），评分为 JD 通用画像参考，仅供参考',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post('/v1/jd/semantic-search', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = semanticSearchSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    try {
      const result = await deps.queue.run(() =>
        semanticSearch(deps.provider, deps.store, parsed.data.query, deps.log.child('search')),
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post('/v1/resume/tailor', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = jdWithResumeSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { jd, resume } = parsed.data;
    const effectiveResume = resume ?? (await loadResumeFile(deps.configDir, deps.log));
    if (!effectiveResume) {
      return c.json({ error: '未配置简历：请先创建 ~/.tomi-job-hunt/resume.md / resume.docx / resume.pdf（模板见 docs/resume.template.md）' }, 400);
    }
    try {
      const tailoredMd = await deps.queue.run(() =>
        tailorResume(deps.provider, jd, effectiveResume, deps.log.child('tailor')),
      );
      return c.json({ tailoredMd });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post('/v1/resume/export', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = exportSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { tailoredMd, format, jdTitle } = parsed.data;
    const safeTitle = (jdTitle ?? 'resume').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'resume';
    if (format === 'md') {
      return new Response(tailoredMd, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeTitle}-tailored.md"`,
        },
      });
    }
    const html = mdToHtml(tailoredMd);
    return new Response(html, {
      headers: {
        // Word opens HTML .doc files natively — zero-dependency export path.
        'Content-Type': 'application/msword; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safeTitle}-tailored.doc"`,
      },
    });
  });

  // --- Phase 3: interview prep ---

  app.post('/v1/interview-prep', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = jdWithResumeSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { jd, resume } = parsed.data;
    const effectiveResume = resume ?? (await loadResumeFile(deps.configDir, deps.log));
    try {
      const result = await deps.queue.run(() =>
        interviewPrep(deps.provider, jd, effectiveResume, deps.log.child('interview')),
      );
      deps.log.info(`interview: ${result.questions.length} questions for ${jd.company}`);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  // --- Phase 4: job application tracker board ---

  app.get('/v1/board', (c) => {
    const entries = deps.board.list();
    const counts = Object.fromEntries(BOARD_STATUSES.map((s) => [s, entries.filter((e) => e.status === s).length]));
    return c.json({ path: deps.board.path, counts, entries });
  });

  app.post('/v1/board', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = boardAddSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const entry = deps.board.add(parsed.data);
    return c.json(entry, 201);
  });

  // --- Phase 6: reverse job hunting ---

  app.post('/v1/hunt/companies', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = huntCompaniesSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { skills, cities, count } = parsed.data;
    try {
      const result = await deps.queue.run(() =>
        huntCompanies(deps.provider, skills, cities, count, deps.log.child('hunt')),
      );
      deps.log.info(`hunt: ${result.companies.length} target companies for [${skills.slice(0, 3).join(', ')}…]`);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });

  app.post('/v1/hunt/cold-email', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = coldEmailSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ error: `Invalid request: ${detail}` }, 400);
    }
    const { company, skills, context, resume } = parsed.data;
    const effectiveResume = resume ?? (await loadResumeFile(deps.configDir, deps.log));
    try {
      const result = await deps.queue.run(() =>
        draftColdEmail(deps.provider, company, skills, effectiveResume, context, deps.log.child('hunt')),
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof ChatProviderError ? 502 : 500;
      return c.json({ error: message }, status);
    }
  });
}
