/**
 * Provider dispatch. Adding a new LLM (local Ollama, ...) means writing one
 * new class implementing ChatProvider and a case here — nothing else in the
 * service changes. deepseek/kimi/qwen share the OpenAI-compatible client.
 */
import type { ChatProvider, ChatRequest, ChatResult, LLMConfig } from '../types.js';
import type { Logger } from '../logger.js';
import { ClaudeCodeProvider } from './claude-code.js';
import { ClaudeAPIProvider } from './claude-api.js';
import { OpenAICompatProvider } from './openai-compat.js';

/**
 * @param workDir dedicated directory passed as `cwd` to the Claude Code CLI
 *   subprocess, so host user settings/CLAUDE.md are never picked up.
 */
export function createChatProvider(cfg: LLMConfig, log: Logger, workDir: string): ChatProvider {
  switch (cfg.provider) {
    case 'claude-code':
      return new ClaudeCodeProvider(cfg, log, workDir);
    case 'claude-api':
      return new ClaudeAPIProvider(cfg, log);
    case 'deepseek':
    case 'kimi':
    case 'qwen':
    case 'openai-compatible':
      return new OpenAICompatProvider(cfg, log);
  }
}

/**
 * Creates the provider without letting an unconfigured provider (e.g.
 * claude-code with no credentials) crash the service on startup. Falls back
 * to a stub whose calls explain that the /setup wizard must be completed
 * first — the wizard hot-reloads the real provider once config is saved.
 */
export function createChatProviderSafe(cfg: LLMConfig, log: Logger, workDir: string): ChatProvider {
  try {
    return createChatProvider(cfg, log, workDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`llm: provider init deferred (${message}) — /setup wizard will complete it`);
    return new UnconfiguredProvider(cfg.provider);
  }
}

class UnconfiguredProvider implements ChatProvider {
  constructor(readonly id: LLMConfig['provider']) {}

  async chat(): Promise<ChatResult> {
    throw new Error(
      'LLM 尚未配置。请打开 http://127.0.0.1:3000/setup 完成设置（选择服务商并填入 API Key）。',
    );
  }

  async *chatStream(): AsyncGenerator<never> {
    throw new Error(
      'LLM 尚未配置。请打开 http://127.0.0.1:3000/setup 完成设置（选择服务商并填入 API Key）。',
    );
  }
}
