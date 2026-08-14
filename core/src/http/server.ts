/**
 * HTTP routes. Local-only API consumed by the browser extension (Phase 1+).
 *
 *   GET  /health   liveness + queue stats
 *   POST /v1/chat  run a chat request through the queue, return ChatResult
 *   GET  /ws       WebSocket job lifecycle events (registered by ws/server.ts)
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
}
