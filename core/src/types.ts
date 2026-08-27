/**
 * Shared types for the Core service.
 * Public interfaces live here so extension code (Phase 1) can depend on them.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Overrides the provider default model. */
  model?: string;
  temperature?: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  text: string;
  /** Model id actually used, resolved by the provider. */
  model: string;
  usage: ChatUsage;
  /** Provider-specific extras (e.g. totalCostUsd from Claude Code SDK). */
  raw?: unknown;
}

/** Incremental stream chunk; `done` marks the final chunk. */
export interface ChatChunk {
  text: string;
  done: boolean;
}

export type ProviderId =
  | 'claude-code'
  | 'claude-api'
  | 'deepseek'
  | 'kimi'
  | 'qwen'
  | 'openai-compatible';

export interface LLMConfig {
  provider: ProviderId;
  /** e.g. 'deepseek-v4-flash' | 'kimi-k2.6' | 'qwen3.7-plus' | 'claude-sonnet-5'. */
  model?: string;
  /**
   * API key. For 'claude-code' leave empty — the SDK/CLI reads
   * ANTHROPIC_API_KEY from the environment (or options.env).
   */
  apiKey?: string;
  /** OpenAI-compatible endpoint base URL. Preset for deepseek/kimi/qwen. */
  baseUrl?: string;
  /**
   * Thinking mode (DeepSeek v4 / Qwen3). Default false: cheap, fast,
   * JSON-friendly (thinking mode ignores temperature).
   */
  thinking?: boolean;
  temperature?: number;
  /** Max in-flight LLM calls. Each claude-code call spawns a CLI subprocess. */
  concurrency: number;
}

export interface ChatProvider {
  readonly id: ProviderId;
  chat(req: ChatRequest): Promise<ChatResult>;
  chatStream(req: ChatRequest): AsyncIterable<ChatChunk>;
}

/** Job lifecycle events broadcast to WebSocket clients on /ws. */
export type WsEvent =
  | { type: 'job/queued'; jobId: string }
  | { type: 'job/started'; jobId: string }
  | { type: 'job/done'; jobId: string; result: unknown }
  | { type: 'job/error'; jobId: string; message: string }
  /** Async JD tagging finished (or failed — tags null, error set). */
  | {
      type: 'jd/tagged';
      jobId: string;
      jobUid: string;
      tags: import('./jd/schema.js').JdTags | null;
      error?: string;
    };

export interface JobRequest {
  jobId: string;
  req: ChatRequest;
}

export interface JobResult {
  jobId: string;
  result: ChatResult;
}
