/**
 * Provider dispatch. Adding a new LLM (Qwen, local Ollama, ...) means writing
 * one new class implementing ChatProvider and a case here — nothing else in
 * the service changes.
 */
import type { ChatProvider, LLMConfig } from '../types.js';
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
    case 'openai-compatible':
      return new OpenAICompatProvider(cfg, log);
  }
}
