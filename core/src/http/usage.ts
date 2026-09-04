/**
 * Usage routes — Settings toggle read/write + daily presence heartbeat.
 *
 *   GET  /v1/usage            current consent + live counters (no installId)
 *   POST /v1/usage/config     { consent?, collectorUrl? }
 *   POST /v1/usage/presence   { app?, appVersion? } → markDaily('app_start')
 *
 * Local-only like everything else (127.0.0.1). Every action routes through the
 * UsageTelemetry consent gate — while OFF nothing is recorded or uploaded.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { Logger } from '../logger.js';
import type { UsageTelemetry } from '../usage/telemetry.js';

export interface UsageDeps {
  usage: UsageTelemetry;
  log: Logger;
}

const usageConfigSchema = z.object({
  consent: z.boolean().optional(),
  /** Empty string resets to the default collector. */
  collectorUrl: z.string().max(500).optional(),
});

const usagePresenceSchema = z.object({
  app: z.string().min(1).max(50).optional(),
  appVersion: z.string().min(1).max(50).optional(),
});

export function registerUsageRoutes(app: Hono, deps: UsageDeps): void {
  const { usage } = deps;

  app.get('/v1/usage', (c) => c.json(usage.getState()));

  app.post('/v1/usage/config', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = usageConfigSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ ok: false, error: `Invalid request: ${detail}` }, 400);
    }
    const { consent, collectorUrl } = parsed.data;
    if (consent !== undefined) usage.setConsent(consent);
    if (collectorUrl !== undefined) usage.setCollectorUrl(collectorUrl);
    return c.json({ ok: true });
  });

  app.post('/v1/usage/presence', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = usagePresenceSchema.safeParse(body ?? {});
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => i.message).join('; ');
      return c.json({ ok: false, error: `Invalid request: ${detail}` }, 400);
    }
    const { app, appVersion } = parsed.data;
    // Only the desktop Agent announces presence — keep attribution honest.
    if (app !== undefined && app !== 'tomi-agent') {
      return c.json({ ok: false, error: 'unknown app' }, 400);
    }
    if (appVersion) usage.setAppVersion(appVersion);
    usage.markDaily('app_start');
    return c.json({ ok: true });
  });
}
