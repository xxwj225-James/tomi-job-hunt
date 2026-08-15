/**
 * Unified JD/intel schema — the heart of TomiHunt's data model.
 *
 * One schema, two uses:
 *   1. Private: LLM-generated tags index the local JD store for semantic search
 *   2. Public (Phase 5+): only tags + structured reports may leave the machine
 *      (the shared feed never contains raw JD text or personal data).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const JD_SOURCES = ['zhipin', 'liepin', 'manual'] as const;
export type JdSource = (typeof JD_SOURCES)[number];

/** Structured fact types users can report. Enum values only — no free text. */
export const REPORT_TYPES = [
  'salary_mismatch', // 实际沟通薪资与 JD 标注不符
  'no_response_30d', // HR 超 30 天未回复/未活跃
  'fake_listing', // 挂职不招 / HR 刷 KPI
  'unpaid_ot', // 无偿加班
  'single_day_off', // 大小周/单休
  'outsourcing', // 外包/驻场
  'no_social_insurance', // 试用期不交社保
  'interview_waste', // 面试体验差 / 要求自带电脑无偿试稿
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const jdTagsSchema = z.object({
  techStack: z.array(z.string().trim().min(1)).max(30).default([]),
  yearsReq: z.enum(['应届', '1-3', '3-5', '5-10', '10+', '不限']).optional(),
  degreeReq: z.enum(['不限', '大专', '本科', '硕士', '博士']).optional(),
  workHours: z.enum(['双休', '大小周', '单休', '弹性', '未标注']).optional(),
  /** Parsed salary range in k/month, e.g. [20, 30]. */
  salaryBandK: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
  riskFlags: z.array(z.string().trim().min(1)).max(10).default([]),
  remote: z.boolean().optional(),
  /** Objective one-line summary, max 50 chars. */
  summary: z.string().trim().min(1).max(50),
});
export type JdTags = z.infer<typeof jdTagsSchema>;

/** Input shape for POST /v1/jd/capture (extension or manual). */
export const jdCaptureInputSchema = z.object({
  source: z.enum(JD_SOURCES),
  url: z.string().min(1),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  salaryText: z.string().default(''),
  requirements: z.string().default(''),
  hrName: z.string().optional(),
});
export type JdCaptureInput = z.infer<typeof jdCaptureInputSchema>;

/** Input shape for POST /v1/jd/:jobUid/report. `ts` is assigned by the store. */
export const jobReportInputSchema = z.object({
  type: z.enum(REPORT_TYPES),
  note: z.string().max(100).optional(),
  evidenceHash: z.string().max(128).optional(),
});
export type JobReportInput = z.infer<typeof jobReportInputSchema>;

export interface JdRecord extends JdCaptureInput {
  /** Dedupe key across users: sha256(company|title) first 16 hex. */
  jobUid: string;
  capturedAt: string;
  tags?: JdTags;
  taggedAt?: string;
}

export interface JobReport {
  type: ReportType;
  note?: string;
  evidenceHash?: string;
  ts: string;
}

/** The only shape of data allowed into a public feed (Phase 5). */
export interface SharedIntel {
  jobUid: string;
  source: JdSource;
  capturedAt: string;
  tags: JdTags | null;
  reports: JobReport[];
}

export function computeJobUid(company: string, title: string): string {
  return createHash('sha256')
    .update(`${company.trim()}|${title.trim()}`)
    .digest('hex')
    .slice(0, 16);
}
