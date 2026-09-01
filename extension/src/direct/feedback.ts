/**
 * 反馈机制 — thumbs + reason tags persisted in chrome.storage.local, aggregated
 * into "personal rules" that get injected into the greeting prompt. This is
 * prompt adaptation, NOT fine-tuning. The same store also collects HR needs
 * (feature: 'hr-needs') from the standalone screening page.
 *
 * 匿名上报（默认开启，options 页可一键关闭）：新增的反馈条目 fire-and-forget POST
 * 到 `FEEDBACK_ENDPOINT`（tomatovector.com 的 `/api/tomihunt-feedback`，见
 * docs/feedback-collector.md）。关闭后或未部署时不发请求，数据完全留在本机。
 * 上报只含 feature/thumbs/tags/note —— 绝不含简历内容。
 */

export const FEEDBACK_KEY = 'tomihunt-feedback';
export const FEEDBACK_OPTIN_KEY = 'tomihunt-feedback-optin';
export const MAX_FEEDBACK = 200;

/**
 * 反馈上报端点（公开 URL，不含任何凭证）。复用 tomatovector.com 反馈系统：
 * 服务端独立表 tomihunt_feedback 落库，admin 后台「TomiHunt 反馈」tab 查看。
 * 留空 = 不上传。public 仓库里这只是部署地址，无安全敏感。
 */
export let FEEDBACK_ENDPOINT = 'https://tomatovector.com/api/tomihunt-feedback';

/** Selectable complaint tags (id → UI label). */
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

/** Complaint tag → durable preference sentence for the greeting prompt. */
const TAG_RULES: Record<string, string> = {
  'too-long': '打招呼语不要太长，删掉套话，控制字数',
  'too-stiff': '打招呼语要口语化，去掉官腔和书面语',
  'no-highlight': '打招呼语要突出简历中最匹配的核心亮点',
  'mismatch-jd': '打招呼语要更贴合目标 JD 的要求',
  'too-generic': '打招呼语要具体，不要模板化套话',
  'wrong-tone': '注意语气分寸，不要过于随意或冒犯',
  'too-flattering': '打招呼语不要吹捧和谄媚',
  'not-ask': '打招呼语结尾要带一个具体问题或行动',
};

export interface FeedbackEntry {
  /** 'greeting' | 'match' | 'hr-needs' | ... — 用户评价对应的操作类型 */
  feature: string;
  ts: number;
  thumbs?: 'up' | 'down';
  tags: string[];
  note?: string;
}

export async function loadFeedback(): Promise<FeedbackEntry[]> {
  try {
    const data = await chrome.storage.local.get(FEEDBACK_KEY);
    const arr = data[FEEDBACK_KEY];
    return Array.isArray(arr) ? (arr as FeedbackEntry[]) : [];
  } catch {
    return [];
  }
}

export async function addFeedback(entry: Omit<FeedbackEntry, 'ts'>): Promise<FeedbackEntry> {
  const full: FeedbackEntry = { ...entry, ts: Date.now() };
  const all = await loadFeedback();
  all.push(full);
  await chrome.storage.local.set({ [FEEDBACK_KEY]: all.slice(-MAX_FEEDBACK) });
  void submitFeedback(full); // fire-and-forget, opt-in gated
  return full;
}

/** 匿名反馈上传是否开启 —— 默认开启，仅当用户显式关闭（storage 值为 false）才停。 */
export async function isFeedbackOptIn(): Promise<boolean> {
  try {
    const data = await chrome.storage.local.get(FEEDBACK_OPTIN_KEY);
    return data[FEEDBACK_OPTIN_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setFeedbackOptIn(on: boolean): Promise<void> {
  await chrome.storage.local.set({ [FEEDBACK_OPTIN_KEY]: on });
}

/**
 * 匿名上报一条反馈到自建端点。三重闸门：未部署（端点空）、未 opt-in、
 * 网络失败 —— 任一命中即静默跳过，绝不影响本地保存。
 * @param endpoint 显式端点（测试用）；默认取编译期 FEEDBACK_ENDPOINT 常量。
 */
export async function submitFeedback(
  entry: FeedbackEntry,
  endpoint: string = FEEDBACK_ENDPOINT,
): Promise<boolean> {
  if (!endpoint) return false;
  if (!(await isFeedbackOptIn())) return false;
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Turns down-thumbs (tag → rule sentence), recent notes and up-thumb counts
 * into a short "how to write for this user" block. Empty store → ''.
 */
export function aggregatePersonalRules(entries: FeedbackEntry[]): string {
  const lines: string[] = [];

  const tagCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.thumbs !== 'down') continue;
    for (const t of e.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  for (const [tag, count] of tagCounts) {
    const rule = TAG_RULES[tag];
    if (rule) lines.push(rule + (count > 1 ? `（${count} 次）` : ''));
  }

  const upCount = entries.filter((e) => e.thumbs === 'up').length;
  if (upCount >= 3) lines.push(`用户认可了 ${upCount} 条打招呼语，继续保持这种风格`);

  const notes = entries
    .map((e) => e.note?.trim())
    .filter((n): n is string => !!n)
    .slice(-5);
  for (const n of notes) lines.push(`用户补充：${n.slice(0, 200)}`);

  return lines.join('\n');
}

/** Wraps rules with a marker so the existing greeting-prompt feedback line reads correctly. */
export function personalRulesPrompt(rules: string): string {
  const r = rules.trim();
  return r ? `[长期偏好规则] 用户希望：\n${r}` : '';
}
