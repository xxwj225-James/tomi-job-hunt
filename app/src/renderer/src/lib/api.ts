/** REST client to the local core service. `base` is set by App once core is up. */
import type {
  BoardEntry,
  BoardView,
  FeedbackEntry,
  FeedbackView,
  GreetingResult,
  Health,
  InterviewQuestion,
  JdParams,
  JdRecord,
  MatchResult,
  MockTurnMsg,
  MockTurnResult,
  MockWrapUp,
  SetupConfig,
  UsageStatus,
  VerifyResult,
} from './types';

let base = '';

export function setApiBase(b: string): void {
  base = b.replace(/\/+$/, '');
}

export function apiBase(): string {
  return base;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function json(method: string, path: string, body?: unknown, want = 'json'): Promise<unknown> {
  if (!base) throw new ApiError('服务未连接');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('无法连接本地服务（core 可能未就绪）');
  }
  if (want === 'blob') return res.blob();
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

const get = (p: string): Promise<unknown> => json('GET', p);
const post = (p: string, b?: unknown): Promise<unknown> => json('POST', p, b);

export const api = {
  health: (): Promise<Health> => get('/health') as Promise<Health>,

  // JD store
  listJds: (limit = 50): Promise<{ total: number; records: JdRecord[] }> =>
    get(`/v1/jd?limit=${limit}`) as Promise<{ total: number; records: JdRecord[] }>,

  // Generators — resume falls back to the local resume file server-side.
  greeting: (jd: JdParams, feedback?: string, tags?: { techStack?: string[]; summary?: string }): Promise<GreetingResult> =>
    post('/v1/greeting', { jd, resume: undefined, feedback, tags: tags ?? null }) as Promise<GreetingResult>,
  match: (jd: JdParams): Promise<MatchResult> =>
    post('/v1/match', { jd, resume: undefined }) as Promise<MatchResult>,
  tailor: (jd: JdParams): Promise<{ tailoredMd: string }> =>
    post('/v1/resume/tailor', { jd, resume: undefined }) as Promise<{ tailoredMd: string }>,
  verify: (markdown: string): Promise<VerifyResult> =>
    post('/v1/resume/verify', { markdown, resume: undefined }) as Promise<VerifyResult>,
  exportResume: (tailoredMd: string, format: 'md' | 'doc', jdTitle?: string): Promise<Blob> =>
    json('POST', '/v1/resume/export', { tailoredMd, format, jdTitle }, 'blob') as Promise<Blob>,
  interviewPrep: (jd: JdParams): Promise<{ questions: InterviewQuestion[] }> =>
    post('/v1/interview-prep', { jd, resume: undefined }) as Promise<{ questions: InterviewQuestion[] }>,
  mockTurn: (jd: JdParams, history: MockTurnMsg[], turnNumber: number): Promise<MockTurnResult> =>
    post('/v1/mock/turn', { jd, resume: undefined, history, turnNumber }) as Promise<MockTurnResult>,
  mockWrapUp: (jd: JdParams, history: MockTurnMsg[]): Promise<MockWrapUp> =>
    post('/v1/mock/wrapup', { jd, resume: undefined, history }) as Promise<MockWrapUp>,

  // Board
  board: (): Promise<BoardView> => get('/v1/board') as Promise<BoardView>,
  boardAdd: (entry: Omit<BoardEntry, 'ts'>): Promise<BoardEntry> =>
    post('/v1/board', entry) as Promise<BoardEntry>,

  // Generation-preference feedback
  feedbackGet: (): Promise<FeedbackView> => get('/v1/feedback') as Promise<FeedbackView>,
  feedbackAdd: (entry: Omit<FeedbackEntry, 'ts'>): Promise<FeedbackEntry> =>
    post('/v1/feedback', entry) as Promise<FeedbackEntry>,

  // Setup
  config: (): Promise<SetupConfig> => get('/setup/config') as Promise<SetupConfig>,
  saveConfig: (patch: Record<string, unknown>): Promise<{ ok: boolean; apiKeySet?: boolean; error?: string }> =>
    post('/setup/config', patch) as Promise<{ ok: boolean; apiKeySet?: boolean; error?: string }>,
  testConfig: (cfg: { provider: string; model?: string; apiKey?: string; baseUrl?: string }): Promise<{ ok: boolean; message?: string; error?: string }> =>
    post('/setup/test', cfg) as Promise<{ ok: boolean; message?: string; error?: string }>,
  /** Explicit local action — returns the decrypted key so it can be re-used. */
  showKey: (): Promise<{ apiKey: string | null }> => post('/setup/show-key') as Promise<{ apiKey: string | null }>,
  // Optional usage telemetry (opt-in, default OFF)
  usageGet: (): Promise<UsageStatus> => get('/v1/usage') as Promise<UsageStatus>,
  usageSet: (patch: { consent?: boolean }): Promise<{ ok: boolean; error?: string }> =>
    post('/v1/usage/config', patch) as Promise<{ ok: boolean; error?: string }>,
  usagePresence: (appVersion?: string): Promise<{ ok: boolean }> =>
    post('/v1/usage/presence', { app: 'tomi-agent', appVersion }) as Promise<{ ok: boolean }>,

  uploadResume: async (file: File): Promise<{ ok: boolean; message?: string; error?: string }> => {
    if (!base) throw new ApiError('服务未连接');
    const fd = new FormData();
    fd.append('file', file);
    let res: Response;
    try {
      res = await fetch(`${base}/setup/resume`, { method: 'POST', body: fd });
    } catch {
      throw new ApiError('无法连接本地服务');
    }
    const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string } | null;
    if (!res.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    return data ?? { ok: true };
  },
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
