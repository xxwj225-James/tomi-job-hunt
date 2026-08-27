/**
 * HTTP/WS client for the local Core service.
 *
 * Core binds localhost only, and its port is AUTO-SELECTED (base 34567,
 * shifting up when busy) so ordinary users never see a port number. The
 * client discovers the port by probing candidates concurrently and caches
 * the winner in chrome.storage.local — cold misses cost ~1.2s, warm hits
 * are instant.
 */
import type { GreetingRequest, GreetingResult, JdCaptureInput, JdTags, WsEvent } from './types.js';

/** Candidate ports Core may pick (keep in sync with core/src/config.ts). */
const PORT_CANDIDATES = [34567, 34568, 34569, 34570];
const CACHE_KEY = 'tomihunt-core-base';
const CACHE_TTL_MS = 30 * 60 * 1000; // revalidate every 30 min

let memoryCache: { base: string; at: number } | null = null;

/** Test hook — clears the in-memory cache (storage cache untouched). */
export function _resetCoreBaseCache(): void {
  memoryCache = null;
}

function isTomiHuntHealth(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { ok?: unknown }).ok === true &&
    typeof (data as { provider?: unknown }).provider === 'string'
  );
}

/** Probes all candidate ports concurrently; first TomiHunt response wins. */
async function probeCandidates(): Promise<string | null> {
  const probes = PORT_CANDIDATES.map(async (port) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1200);
      const resp = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) return null;
      if (isTomiHuntHealth(await resp.json())) return `http://127.0.0.1:${port}`;
    } catch {
      // not this port
    }
    return null;
  });
  const results = await Promise.all(probes);
  return results.find((base) => base !== null) ?? null;
}

/** Resolves the Core base URL, consulting storage + memory cache first. */
export async function getCoreBase(): Promise<string | null> {
  if (memoryCache && Date.now() - memoryCache.at < CACHE_TTL_MS) return memoryCache.base;
  try {
    const data = await chrome.storage.local.get(CACHE_KEY);
    const cached = data[CACHE_KEY] as { base: string; at: number } | undefined;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      memoryCache = cached;
      return cached.base;
    }
  } catch {
    // storage unavailable — probe directly
  }
  const found = await probeCandidates();
  if (found) {
    memoryCache = { base: found, at: Date.now() };
    try {
      await chrome.storage.local.set({ [CACHE_KEY]: memoryCache });
    } catch {
      // best-effort cache
    }
  }
  return found;
}

export const CORE_BASE = 'http://127.0.0.1:34567'; // default candidate; always prefer getCoreBase()

export class CoreClient {
  constructor() {}

  private async base(): Promise<string> {
    return (await getCoreBase()) ?? CORE_BASE;
  }

  async health(): Promise<{ ok: boolean; provider: string; queue: { active: number; pending: number } }> {
    const base = await this.base();
    const resp = await fetch(`${base}/health`);
    return (await resp.json()) as { ok: boolean; provider: string; queue: { active: number; pending: number } };
  }

  async captureJd(jd: JdCaptureInput): Promise<{ jobUid: string; taggingJobId: string }> {
    const base = await this.base();
    const resp = await fetch(`${base}/v1/jd/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jd),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `capture failed: ${resp.status}`);
    }
    return (await resp.json()) as { jobUid: string; taggingJobId: string };
  }

  async greeting(req: GreetingRequest): Promise<GreetingResult> {
    const base = await this.base();
    const resp = await fetch(`${base}/v1/greeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    if (!resp.ok) {
      const body = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `greeting failed: ${resp.status}`);
    }
    return (await resp.json()) as GreetingResult;
  }

  /** Opens a WS connection and routes lifecycle events; returns a closer. */
  async watch(onEvent: (event: WsEvent) => void): Promise<() => void> {
    const base = await this.base();
    const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data as string) as WsEvent);
      } catch {
        // ignore malformed frames
      }
    };
    return () => ws.close();
  }
}

/**
 * Syncs the extension's direct-mode config to a running Core service
 * (/setup/config merges + hot-reloads the provider). Makes the extension
 * settings the single source of truth — the popup and Core then agree on
 * the provider. Silent no-op when Core is offline or unconfigured.
 */
export async function syncConfigToCore(cfg: { provider: string; model: string; apiKey: string; baseUrl?: string }): Promise<boolean> {
  const base = await getCoreBase();
  if (!base) return false;
  try {
    const resp = await fetch(`${base}/setup/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 'generic' maps to Core's openai-compatible (user-supplied baseUrl)
        provider: cfg.provider === 'generic' ? 'openai-compatible' : cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl ?? '',
      }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** One-line tag summary for the floating panel. */
export function formatTags(tags: JdTags): string {
  const parts: string[] = [];
  if (tags.techStack.length > 0) parts.push(`技术栈: ${tags.techStack.slice(0, 8).join(', ')}`);
  if (tags.yearsReq) parts.push(`年限: ${tags.yearsReq}`);
  if (tags.degreeReq) parts.push(`学历: ${tags.degreeReq}`);
  if (tags.workHours) parts.push(`工时: ${tags.workHours}`);
  if (tags.salaryBandK) parts.push(`薪资: ${tags.salaryBandK[0]}-${tags.salaryBandK[1]}k`);
  if (tags.riskFlags.length > 0) parts.push(`⚠ 风险: ${tags.riskFlags.join(', ')}`);
  return parts.join(' | ');
}
