/**
 * OpenAI-compatible provider — reserved for DeepSeek / Qwen (Phase 2+).
 *
 * The ChatProvider interface is fully satisfied so nothing upstream needs to
 * change when the real implementation lands: an OpenAI-compatible
 * /chat/completions client keyed by baseUrl. Throws until then.
 */
import type { ChatChunk, ChatProvider, ChatRequest, ChatResult, LLMConfig } from '../types.js';
import type { Logger } from '../logger.js';
import { ChatProviderError } from './chat-provider.js';

export class OpenAICompatProvider implements ChatProvider {
  readonly id = 'openai-compatible' as const;

  constructor(
    private readonly cfg: LLMConfig,
    log: Logger,
  ) {
    log.warn('openai-compatible: provider is a stub — planned for Phase 2 (DeepSeek/Qwen)');
  }

  async chat(_req: ChatRequest): Promise<ChatResult> {
    throw new ChatProviderError(
      this.id,
      'openai-compatible is not implemented yet (planned for Phase 2). Use provider "claude-code" or "claude-api" for now.',
    );
  }

  async *chatStream(_req: ChatRequest): AsyncIterable<ChatChunk> {
    throw new ChatProviderError(
      this.id,
      'openai-compatible is not implemented yet (planned for Phase 2). Use provider "claude-code" or "claude-api" for now.',
    );
  }
}
