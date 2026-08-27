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
}

export interface GreetingResult {
  pitch: string;
  /** Set when resume.md was not configured and the pitch is JD-only. */
  warning?: string;
}

export type WsEvent =
  | { type: 'job/queued'; jobId: string }
  | { type: 'job/started'; jobId: string }
  | { type: 'job/done'; jobId: string; result: unknown }
  | { type: 'job/error'; jobId: string; message: string }
  | { type: 'jd/tagged'; jobId: string; jobUid: string; tags: JdTags | null; error?: string };
