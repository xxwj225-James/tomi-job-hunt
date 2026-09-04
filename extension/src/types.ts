/**
 * Types shared with the Core service (mirror of core/src/jd/schema.ts).
 * Duplicated intentionally — content scripts bundle everything via Vite and
 * importing from core/ would drag zod into the extension.
 */

export type JdSource = 'zhipin' | 'liepin' | 'manual';

export interface JdCaptureInput {
  source: JdSource;
  url: string;
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}

export interface JdTags {
  techStack: string[];
  yearsReq?: '应届' | '1-3' | '3-5' | '5-10' | '10+' | '不限';
  degreeReq?: '不限' | '大专' | '本科' | '硕士' | '博士';
  workHours?: '双休' | '大小周' | '单休' | '弹性' | '未标注';
  salaryBandK?: [number, number];
  riskFlags: string[];
  remote?: boolean;
  summary: string;
}

/** A JD-oriented matching point: one real resume fact, reframed toward the JD. */
export interface GreetingPoint {
  /** A JD keyword (from techStack / requirements) the resume genuinely covers. */
  keyword: string;
  /** One-line, ≤40 chars — the resume fact restated in the JD's domain framing. */
  reframed: string;
}

export interface GreetingRequest {
  jd: {
    title: string;
    company: string;
    salaryText: string;
    requirements: string;
    hrName?: string;
  };
  resume?: string;
  /** User feedback on a previous pitch — regeneration guidance. */
  feedback?: string;
  /** Structured JD tags (techStack/summary) from the tagger — feeds Stage-1 point extraction. */
  tags?: { techStack?: string[]; summary?: string } | null;
}

export interface ReplyTurn {
  speaker: 'hr' | 'me';
  content: string;
}

export interface ReplyRequest {
  jd: { title: string; company: string; salaryText: string; requirements: string };
  resume?: string;
  history: ReplyTurn[];
  incoming: string;
}

export interface ReplyResult {
  reply: string;
}

export interface GreetingResult {
  pitch: string;
  /** Set when resume.md was not configured and the pitch is JD-only. */
  warning?: string;
  /** Stage-1 JD-oriented matching points the pitch was built from (for display). */
  points?: GreetingPoint[];
}

export type WsEvent =
  | { type: 'job/queued'; jobId: string }
  | { type: 'job/started'; jobId: string }
  | { type: 'job/done'; jobId: string; result: unknown }
  | { type: 'job/error'; jobId: string; message: string }
  | { type: 'jd/tagged'; jobId: string; jobUid: string; tags: JdTags | null; error?: string };

/**
 * LLM message shape used by direct/llm.ts `directChat` — was imported but
 * never declared here (esbuild strips the import so the build passed, but
 * `tsc --noEmit` failed). Now declared so extension feature code type-checks.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimal job-description shape shared by greeting/match/interview/tailor/mock. */
export interface JdLike {
  title: string;
  company: string;
  salaryText: string;
  requirements: string;
  hrName?: string;
}
