import { describe, expect, it, vi } from 'vitest';
import { createChatProviderSafe } from './factory.js';
import { Logger } from '../logger.js';

vi.mock('../llm/claude-code.js', () => ({
  ClaudeCodeProvider: class {
    readonly id = 'claude-code' as const;
    constructor() {
      throw new Error('No Anthropic credentials found');
    }
    async chat(): Promise<never> {
      throw new Error('unreachable');
    }
    async *chatStream(): AsyncGenerator<never> {
      throw new Error('unreachable');
    }
  },
}));

const silentLog = new Logger('error', 'test');

describe('createChatProviderSafe', () => {
  it('falls back to a stub when provider init throws (unconfigured claude-code)', async () => {
    const provider = await createChatProviderSafe(
      { provider: 'claude-code', concurrency: 1 },
      silentLog,
      '/tmp/work',
    );
    expect(provider.id).toBe('claude-code');
    await expect(provider.chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/setup/);
  });

  it('returns the real provider when init succeeds', async () => {
    const provider = await createChatProviderSafe(
      { provider: 'deepseek', apiKey: 'sk-x', concurrency: 1 },
      silentLog,
      '/tmp/work',
    );
    expect(provider.id).toBe('deepseek');
  });
});
