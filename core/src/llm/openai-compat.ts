/**
 * OpenAI-compatible provider — powers DeepSeek / Kimi / Qwen presets and any
 * custom baseUrl. Fetch-based, zero extra deps.
 *
 * Provider-specific params adapted from TomiLite's production integration:
 *   - DeepSeek v4: unified model, thinking toggled via `thinking: {type}`
 *     (thinking mode ignores temperature — default disabled for JSON tasks)
 *   - Qwen3: `enable_thinking` only sent when true; never send tool_choice
 *   - Kimi: standard OpenAI params, nothing extra
 *   - max_tokens ceiling: deepseek 16000, others 8192
 */
import type {
  ChatChunk,
  ChatProvider,
  ChatRequest,
  ChatResult,
  ChatUsage,
  LLMConfig,
} from '../types.js';
import type { Logger } from '../logger.js';
import { ChatProviderError } from './chat-provider.js';

const DEFAULT_MAX_TOKENS = 4096;
/** Ceiling per provider family (TomiLite-verified). */
const PROVIDER_MAX_TOKENS = { deepseek: 16000, other: 8192 } as const;

/** Incremental SSE decoder for OpenAI-style `data: {...}` streams. */
export class SseDecoder {
  private buffer = '';

  /** Feeds a raw chunk; returns parsed `delta.content` texts (may be empty). */
  feed(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const deltas: string[] = [];
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
        const text = json.choices?.[0]?.delta?.content;
        if (text) deltas.push(text);
      } catch {
        // skip malformed keep-alive lines
      }
    }
    return deltas;
  }
}

export class OpenAICompatProvider implements ChatProvider {
  readonly id: 'deepseek' | 'kimi' | 'qwen' | 'openai-compatible';

  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    private readonly cfg: LLMConfig,
    log: Logger,
  ) {
    this.id = cfg.provider as OpenAICompatProvider['id'];
    const apiKey = cfg.apiKey ?? process.env.TOMI_API_KEY;
    if (!apiKey) {
      throw new ChatProviderError(
        this.id,
        `Missing API key for provider "${this.id}". Set TOMI_API_KEY or config.json "apiKey". See .env.example.`,
      );
    }
    const baseUrl = cfg.baseUrl;
    if (!baseUrl) {
      throw new ChatProviderError(
        this.id,
        `Missing baseUrl for provider "${this.id}". Set TOMI_BASE_URL or config.json "baseUrl".`,
      );
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    log.debug(`${this.id}: client ready (${this.baseUrl}, model ${this.cfg.model ?? 'per-request'})`);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body = this.buildBody(req, false);
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ChatProviderError(this.id, `Request failed: ${(err as Error).message}`, err);
    }
    if (!resp.ok) {
      throw new ChatProviderError(this.id, await errorMessage(this.id, resp));
    }
    const json = (await resp.json()) as {
      model?: string;
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = json.choices?.[0]?.message ?? {};
    const usage: ChatUsage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
    return {
      text: message.content ?? '',
      model: json.model ?? this.cfg.model ?? 'unknown',
      usage,
      raw: { reasoningContent: message.reasoning_content, finishReason: json.choices?.[0]?.finish_reason },
    };
  }

  async *chatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
    const body = this.buildBody(req, true);
    let resp: Response;
    try {
      resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ChatProviderError(this.id, `Request failed: ${(err as Error).message}`, err);
    }
    if (!resp.ok) {
      throw new ChatProviderError(this.id, await errorMessage(this.id, resp));
    }
    if (!resp.body) throw new ChatProviderError(this.id, 'No stream response');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const deltas = sse.feed(decoder.decode(value, { stream: true }));
      for (const text of deltas) yield { text, done: false };
    }
    yield { text: '', done: true };
  }

  private buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model(req),
      stream,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: Math.min(DEFAULT_MAX_TOKENS, this.providerMaxTokens()),
    };
    if (req.temperature !== undefined || this.cfg.temperature !== undefined) {
      body.temperature = req.temperature ?? this.cfg.temperature;
    }
    const thinking = this.cfg.thinking === true;
    if (this.isDeepSeek()) {
      // v4 unified model: toggle via param; disabled = deterministic + JSON-friendly
      body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    } else if (this.isQwen()) {
      // Only send when true — some Qwen tiers reject the param or are thinking-only.
      if (thinking) body.enable_thinking = true;
    }
    return body;
  }

  private model(req: ChatRequest): string {
    const model = req.model ?? this.cfg.model;
    if (!model) {
      throw new ChatProviderError(
        this.id,
        `No model configured for provider "${this.id}". Set TOMI_MODEL or config.json "model".`,
      );
    }
    return model;
  }

  private providerMaxTokens(): number {
    return this.isDeepSeek() ? PROVIDER_MAX_TOKENS.deepseek : PROVIDER_MAX_TOKENS.other;
  }

  private isDeepSeek(): boolean {
    return this.baseUrl.includes('deepseek');
  }

  private isQwen(): boolean {
    return this.baseUrl.includes('dashscope');
  }
}

async function errorMessage(provider: string, resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '');
  return `API error ${resp.status} from ${provider}: ${text.slice(0, 200)}`;
}
