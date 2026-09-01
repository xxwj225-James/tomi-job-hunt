/**
 * 模拟面试 — turn-based mock interview in direct mode. One `directChat` per
 * turn with a strict JSON contract; the transcript lives in the workspace page
 * (in-memory + persisted under `tomihunt-mock-last`). Parsers reuse
 * extractJson from prompts.ts + manual shape checks (the codebase's zod-free
 * convention).
 */
import { directChat } from './llm.js';
import { extractJson } from './prompts.js';
import type { JdLike } from '../types.js';

export interface MockTurn {
  speaker: 'ai' | 'user';
  content: string;
}

export interface MockTurnResult {
  /** Annotation for the user's last answer; absent on the first question. */
  feedback?: string;
  nextQuestion: string;
}

export interface MockWrapUp {
  feedback: string;
  suggestions: string[];
}

const HISTORY_LIMIT = 10;
const JD_LIMIT = 4000;
const RESUME_LIMIT = 4000;

function buildContext(jd: JdLike, resume: string | undefined, history: MockTurn[]): string {
  const historyPart =
    history.length > 0
      ? `\n\n已进行的对话（时间顺序）：\n${history
          .slice(-HISTORY_LIMIT)
          .map((t) => `${t.speaker === 'ai' ? '[面试官]' : '[求职者]'} ${t.content.slice(0, 400)}`)
          .join('\n')}`
      : '\n\n（这是第一个问题）';
  return `目标岗位：${jd.title}\n公司：${jd.company}\n薪资：${jd.salaryText || '未标注'}\n任职要求：\n${jd.requirements.slice(0, JD_LIMIT) || '未提供'}\n\n求职者简历（节选）：\n${(resume ?? '').slice(0, RESUME_LIMIT) || '（未提供）'}${historyPart}`;
}

export function buildMockTurnPrompt(
  jd: JdLike,
  resume: string | undefined,
  history: MockTurn[],
  turnNumber: number,
): string {
  return `你是资深面试官，正在对求职者进行 1:1 中文模拟面试。围绕目标岗位深挖真实能力，一次只问一个问题。

${buildContext(jd, resume, history)}

现在输出 JSON（不要任何解释）：
{"feedback": "对求职者上一句回答的简短诚恳点评（≤60字；如果是第一个问题则省略此字段）", "nextQuestion": "下一个面试问题或针对上一句回答的追问（≤120字；不要重复已问过的问题）"}

规则：
- 技术问题优先结合 JD 技术栈与简历中的项目经历深挖
- 行为问题用 STAR 情境追问（当时情况、任务、行动、结果）
- 追问要顺着求职者的上一句回答，不要跳题`;
}

export function buildMockWrapUpPrompt(jd: JdLike, resume: string | undefined, history: MockTurn[]): string {
  return `你是资深面试官。模拟面试已结束，请对求职者整体表现给出总结。

${buildContext(jd, resume, history)}

现在输出 JSON（不要任何解释）：
{"feedback": "整体评价（≤150字，指出优点与需要改进的点）", "suggestions": ["建议1（≤40字）", "建议2（≤40字）", ...最多5条"]}`;
}

export function parseMockTurn(text: string): MockTurnResult {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const nextQuestion = String(raw.nextQuestion ?? '').trim();
  if (!nextQuestion) throw new Error('模拟面试返回缺少下一问');
  const feedback = typeof raw.feedback === 'string' && raw.feedback.trim() ? raw.feedback.trim() : undefined;
  return { feedback, nextQuestion: nextQuestion.slice(0, 300) };
}

export function parseMockWrapUp(text: string): MockWrapUp {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const feedback = String(raw.feedback ?? '').trim() || '模拟面试已结束。';
  const suggestions = Array.isArray(raw.suggestions)
    ? (raw.suggestions as unknown[]).map((s) => String(s).slice(0, 80))
    : [];
  return { feedback, suggestions: suggestions.slice(0, 5) };
}

export async function directMockInterviewTurn(
  jd: JdLike,
  resume: string | undefined,
  history: MockTurn[],
  turnNumber: number,
): Promise<MockTurnResult> {
  const result = await directChat([
    { role: 'user', content: buildMockTurnPrompt(jd, resume, history, turnNumber) },
  ]);
  return parseMockTurn(result.text);
}

export async function directMockInterviewWrapUp(
  jd: JdLike,
  resume: string | undefined,
  history: MockTurn[],
): Promise<MockWrapUp> {
  const result = await directChat([{ role: 'user', content: buildMockWrapUpPrompt(jd, resume, history) }]);
  return parseMockWrapUp(result.text);
}
