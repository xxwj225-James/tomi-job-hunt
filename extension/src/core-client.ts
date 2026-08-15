/**
 * HTTP/WS client for the local Core service (127.0.0.1:3000).
 * Core binds localhost only — this client is the extension's only gateway.
 */
import type { GreetingRequest, GreetingResult, JdCaptureInput, JdTags, WsEvent } from './types.js';

export const CORE_BASE = 'http://127.0.0.1:3000';

export class CoreClient {
  constructor(private readonly base: string = CORE_BASE) {}

  async health(): Promise<{ ok: boolean; provider: string; queue: { active: number; pending: number } }> {
    const resp = await fetch(`${this.base}/health`);
    return (await resp.json()) as { ok: boolean; provider: string; queue: { active: number; pending: number } };
  }

  async captureJd(jd: JdCaptureInput): Promise<{ jobUid: string; taggingJobId: string }> {
    const resp = await fetch(`${this.base}/v1/jd/capture`, {
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
    const resp = await fetch(`${this.base}/v1/greeting`, {
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
  watch(onEvent: (event: WsEvent) => void): () => void {
    const ws = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws');
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
