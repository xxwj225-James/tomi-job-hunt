/** Shared renderer types — mirrors the core REST payloads the UI talks to. */

export type JdSource = 'zhipin' | 'liepin' | 'manual';

export const SOURCE_LABEL: Record<JdSource, string> = {
  zhipin: 'Boss直聘',
  liepin: '猎聘',
  manual: '手动添加',
};

export const REASON_LABEL: Record<FailedReason, string> = {
  'tab-closed': '聊天窗口已关闭',
  'tab-idle': '该 JD 的聊天页未打开（停留在 JD 详情页）',
  'selector-failed': '页面结构变化，未能定位到输入框',
  'tab-offline': '插件未上线 / 窗口离线超时',
};

export interface JdTags {
  techStack: string[];
  yearsReq?: string;
  degreeReq?: string;
  workHours?: string;
  salaryBandK?: [number, number];
  riskFlags: string[];
  remote?: boolean;
  summary: string;
}

export interface JdRecord {
  jobUid: string;
  source: JdSource;
  url: string;
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
  capturedAt: string;
  tags?: JdTags;
  taggedAt?: string;
}

export interface JdParams {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}

export function toJdParams(r: Pick<JdRecord, 'title' | 'company' | 'salaryText' | 'requirements' | 'hrName'>): JdParams {
  return { title: r.title, company: r.company, salaryText: r.salaryText, requirements: r.requirements, hrName: r.hrName };
}

export interface GreetingPoint {
  keyword: string;
  reframed: string;
}

export interface GreetingResult {
  pitch: string;
  warning?: string;
  points?: GreetingPoint[];
}

export interface MatchResult {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  risks: string[];
  warning?: string;
}

export interface Health {
  ok: boolean;
  provider: string;
  queue: { active: number; pending: number };
  wsClients: number;
}

export interface InterviewQuestion {
  q: string;
  intent: string;
  starHint: string;
}

export type MockSpeaker = 'ai' | 'user';

export interface MockTurnMsg {
  speaker: MockSpeaker;
  content: string;
}

export interface MockTurnResult {
  feedback?: string;
  nextQuestion: string;
}

export interface MockWrapUp {
  feedback: string;
  suggestions: string[];
}

export interface VerifyResult {
  fabricated: string[];
  unverified: boolean;
}

export type BoardStatus = 'greeted' | 'applied' | 'interview' | 'offer' | 'rejected';

export interface BoardEntry {
  ts: string;
  status: BoardStatus;
  company: string;
  title: string;
  url: string;
  note?: string;
}

export interface BoardView {
  path: string;
  counts: Record<BoardStatus, number>;
  entries: BoardEntry[];
}

export interface SetupConfig {
  configDir: string;
  configFileExists: boolean;
  provider: string;
  model: string;
  apiKeySet: boolean;
  apiKeyMasked?: string;
  baseUrl: string;
  thinking: boolean;
  temperature: number;
  concurrency: number;
  port: number;
  logLevel: string;
}

/* ── Optional usage telemetry (opt-in, default OFF) ─── */

export interface UsageStatus {
  consent: boolean;
  collectorUrl: string;
  day: string;
  events: Record<string, number>;
}

/* ── Generation-preference feedback (shared personal-rules bank) ─── */

/** Selectable complaint tags (id → UI label). Mirrors core/src/jd/feedback.ts. */
export const FEEDBACK_TAGS: Record<string, string> = {
  'too-long': '太长',
  'too-stiff': '太官腔/太书面',
  'no-highlight': '没突出亮点',
  'mismatch-jd': '不匹配JD',
  'too-generic': '太笼统/模板感',
  'wrong-tone': '语气不合适',
  'too-flattering': '吹捧/谄媚',
  'not-ask': '结尾没提问/没行动',
};

export interface FeedbackEntry {
  /** 'greeting' | 'match' | ... — 用户评价对应的操作类型 */
  feature: string;
  ts: number;
  thumbs?: 'up' | 'down';
  tags: string[];
  note?: string;
}

export interface FeedbackView {
  path: string;
  count: number;
  entries: FeedbackEntry[];
  /** Aggregated personal-rules block to merge into the greeting feedback param. */
  rules: string;
}

/* ── WS agent gateway (console side) ─── */

export type SessionStatus = 'online' | 'offline';

export interface SessionInfo {
  targetId: string;
  tabId?: number;
  status: SessionStatus;
  lastSeen: number;
}

export type FailedReason = 'tab-closed' | 'tab-idle' | 'selector-failed' | 'tab-offline';

export type SendOutcome =
  | { kind: 'ok'; domSnippet?: string }
  | { kind: 'failed'; reason: FailedReason }
  | { kind: 'error'; error: string };

/** Local UI status of a send command. */
export interface SendState {
  state: 'idle' | 'sending' | 'pending' | 'ok' | 'failed';
  note?: string;
  reason?: FailedReason;
  domSnippet?: string;
  at: number;
}
