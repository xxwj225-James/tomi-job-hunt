/**
 * Backend routing — non-technical users run with NO local service.
 *
 * Every LLM feature probes the Core service first (1.5 s timeout, result
 * cached 30 s): if it's running, use it (full feature set, resume.md,
 * board); otherwise fall back to direct-mode (LLM APIs called straight
 * from the extension, API key configured in the options page).
 */
import { CORE_BASE as CORE_BASE_FALLBACK, getCoreBase, CoreClient } from '../core-client.js';
import { directGreeting, directInterviewPrep, directMatch, directTagJd } from '../direct/prompts.js';
import { loadResume } from '../direct/resume.js';
import type { GreetingResult, JdTags } from '../types.js';

export type Backend = 'core' | 'direct';

let cached: Backend | null = null;
let checkedAt = 0;
const CACHE_MS = 30_000;

export async function detectBackend(): Promise<Backend> {
  if (cached && Date.now() - checkedAt < CACHE_MS) return cached;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const base = (await getCoreBase()) ?? CORE_BASE_FALLBACK;
    const resp = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    cached = resp.ok ? 'core' : 'direct';
  } catch {
    cached = 'direct';
  }
  checkedAt = Date.now();
  return cached;
}

const client = new CoreClient();

export interface JdLike {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}

async function corePost<T>(path: string, body: unknown): Promise<T> {
  const base = (await getCoreBase()) ?? CORE_BASE_FALLBACK;
  const resp = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

/** Synchronous tag (direct mode). Core's async capture+WS flow is handled by the caller. */
export async function backendTag(jd: JdLike): Promise<JdTags> {
  return directTagJd(jd);
}

export async function backendGreeting(jd: JdLike): Promise<GreetingResult> {
  if ((await detectBackend()) === 'core') {
    // Core loads ~/.tomi-job-hunt/resume.md itself
    return client.greeting({ jd: { ...jd, hrName: jd.hrName } });
  }
  return directGreeting(jd, await loadResume());
}

export async function backendMatch(jd: JdLike) {
  if ((await detectBackend()) === 'core') {
    return corePost<Record<string, unknown>>('/v1/match', { jd });
  }
  return directMatch(jd, await loadResume());
}

export async function backendInterview(jd: JdLike) {
  if ((await detectBackend()) === 'core') {
    return corePost<{ questions: Array<{ q: string; intent: string; starHint: string }> }>(
      '/v1/interview-prep',
      { jd },
    );
  }
  return directInterviewPrep(jd, await loadResume());
}
