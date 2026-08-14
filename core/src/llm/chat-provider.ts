/**
 * Base error for all LLM provider failures. Messages are user-facing: they
 * should say what's wrong and how to fix it (e.g. which env var to set).
 */

export class ChatProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ChatProviderError';
  }
}
