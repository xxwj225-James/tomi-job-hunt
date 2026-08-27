/**
 * Claude API provider — direct Messages API calls via @anthropic-ai/sdk.
 * Lightweight alternative to claude-code: no subprocess, no agent loop.
 */
import Anthropic from '@anthropic-ai/sdk';
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
/** Anthropic Messages API accepts temperature in [0, 1]; config allows [0, 2] for OpenAI-compat providers. */
const MAX_TEMPERATURE = 1;

export class ClaudeAPIProvider implements ChatProvider {
  readonly id = 'claude-api' as const;

  private readonly client: Anthropic;

  constructor(
    private readonly cfg: LLMConfig,
    log: Logger,
  ) {
    const apiKey = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
    // ANTHROPIC_AUTH_TOKEN is the short-lived token the Claude CLI uses when
    // logged in without an API key; the Messages API accepts it via authToken.
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    if (!apiKey && !authToken) {
      throw new ChatProviderError(
        this.id,
        'Missing ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN). Set it in the environment or ~/.tomi-job-hunt/config.json. See .env.example.',
      );
    }
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic({ authToken });
    log.debug('claude-api: client created');
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    try {
      const resp = await this.client.messages.create({
        model: this.model(req),
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: this.temperature(req),
        system: systemText(req),
        messages: apiMessages(req),
      });
      const text = resp.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      const usage: ChatUsage = {
        inputTokens: resp.usage.input_tokens,
        outputTokens: resp.usage.output_tokens,
      };
      return { text, model: resp.model, usage, raw: { stopReason: resp.stop_reason } };
    } catch (err) {
      throw new ChatProviderError(this.id, `Claude API call failed: ${(err as Error).message}`, err);
    }
  }

  async *chatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
    try {
      const stream = await this.client.messages.create({
        model: this.model(req),
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: this.temperature(req),
        system: systemText(req),
        messages: apiMessages(req),
        stream: true,
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { text: event.delta.text, done: false };
        }
      }
    } catch (err) {
      if (err instanceof ChatProviderError) throw err;
      throw new ChatProviderError(this.id, `Claude API call failed: ${(err as Error).message}`, err);
    }
    yield { text: '', done: true };
  }

  private model(req: ChatRequest): string {
    const model = req.model ?? this.cfg.model;
    if (!model) {
      throw new ChatProviderError(this.id, 'No model configured. Set TOMI_MODEL or config.json "model".');
    }
    return model;
  }

  private temperature(req: ChatRequest): number | undefined {
    const t = req.temperature ?? this.cfg.temperature;
    return t === undefined ? undefined : Math.min(t, MAX_TEMPERATURE);
  }
}

// --- helpers ---

function systemText(req: ChatRequest): string | undefined {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return system || undefined;
}

function apiMessages(req: ChatRequest): Array<{ role: 'user' | 'assistant'; content: string }> {
  return req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}
