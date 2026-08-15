/**
 * Local sanitization pipeline — the compliance moat.
 *
 * Anything that could ever be shared must pass through here first:
 * PII is masked, free text is truncated and neutralized. The deep
 * "AI compliance rewrite" pass (translating angry rants into neutral
 * factual statements) lands with the report UI in a later phase.
 */
import type { JdRecord, JobReport, SharedIntel } from './schema.js';

const MASK = '[已屏蔽]';

// --- PII patterns (Chinese market) ---
const CN_MOBILE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CN_LANDLINE_RE = /(?<!\d)0\d{2,3}-\d{7,8}(?:\d-\d{3,4})?(?!\d)/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const WECHAT_RE = /(微信|weixin|WeChat|vx|VX)\s*[:：]?\s*[a-zA-Z][a-zA-Z0-9_-]{5,19}/g;

/** Masks phone numbers, emails and WeChat ids in arbitrary text. */
export function sanitizePii(text: string): string {
  return text
    .replace(WECHAT_RE, (_m, label: string) => `${label}: ${MASK}`)
    .replace(EMAIL_RE, MASK)
    .replace(CN_MOBILE_RE, MASK)
    .replace(CN_LANDLINE_RE, MASK);
}

// --- Subjective/abusive language → neutral factual phrasing ---
// Conservative table; deeper AI-based rewriting arrives with the report UI.
const NEUTRALIZE: Array<[RegExp, string]> = [
  [/(?:这|这家)?垃圾公司/g, '该公司口碑存在争议'],
  [/骗子/g, '招聘信息与实际情况不符'],
  [/骗人/g, '招聘信息与实际情况不符'],
  [/坑死|坑人|坑爹/g, '体验不佳'],
  [/傻逼|煞笔|沙雕|白痴/g, MASK],
  [/\b(sb|nmsl|cnm|tmd)\b/gi, MASK],
  [/千万别去/g, '建议谨慎考虑'],
  [/别去这家/g, '建议谨慎考虑'],
  [/黑心/g, '存在问题'],
];

const MAX_NOTE_LENGTH = 100;

/**
 * Sanitizes a user-submitted report note: PII masking, neutralization of
 * abusive language, length clamp. Safe to store and (Phase 5) share.
 */
export function sanitizeReportNote(note: string): string {
  let out = sanitizePii(note.trim());
  for (const [re, replacement] of NEUTRALIZE) {
    out = out.replace(re, replacement);
  }
  return out.slice(0, MAX_NOTE_LENGTH);
}

/**
 * Builds the ONLY shape of data allowed into a public feed: tags + reports.
 * Raw JD text, HR name and URL never survive this function — by construction.
 */
export function buildSharedIntel(record: JdRecord, reports: JobReport[]): SharedIntel {
  return {
    jobUid: record.jobUid,
    source: record.source,
    capturedAt: record.capturedAt,
    tags: record.tags ?? null,
    reports,
  };
}
