/**
 * Claude Code provider — drives the Claude Code SDK (agent-sdk 0.3.232).
 *
 * Each call spawns a Claude Code CLI subprocess, so callers must go through
 * the TaskQueue (see queue.ts). Runs headless: permissions bypassed, tools
 * disabled, settings isolated from the host user's ~/.claude.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKAssistantMessage, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatChunk, ChatProvider, ChatRequest, ChatResult, LLMConfig } from '../types.js';
import type { Logger } from '../logger.js';
import { ChatProviderError } from './chat-provider.js';

const MAX_TURNS = 5;

export class ClaudeCodeProvider implements ChatProvider {
  readonly id = 'claude-code' as const;

  constructor(
    private readonly cfg: LLMConfig,
    private readonly log: Logger,
    /** Dedicated work dir so the CLI never reads the host user's settings/CLAUDE.md. */
    private readonly workDir: string,
  ) {
    if (!hasCredentials()) {
      throw new ChatProviderError(
        this.id,
        'No Anthropic credentials found. Set ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN), ' +
          'or run "claude login" once. See .env.example.',
      );
    }
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    let accumulated = '';
    let finalText: string | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };
    let model = this.cfg.model ?? 'unknown';
    let totalCostUsd: number | undefined;

    try {
      for await (const event of this.query(req)) {
        if (isAssistantMessage(event)) {
          accumulated += extractText(event);
        } else if (isResultMessage(event)) {
          if (event.subtype === 'error' || event.is_error) {
            throw new ChatProviderError(this.id, `Claude Code run failed: ${event.result || 'unknown error'}`);
          }
          // The result carries the definitive final text; accumulated covers streamed turns.
          finalText = event.result;
          model = modelFromUsage(event, model);
          usage = sumUsage(event.modelUsage);
          totalCostUsd = event.total_cost_usd;
        }
      }
    } catch (err) {
      if (err instanceof ChatProviderError) throw err;
      throw new ChatProviderError(this.id, `Claude Code call failed: ${(err as Error).message}`, err);
    }

    return { text: finalText ?? accumulated, model, usage, raw: { totalCostUsd } };
  }

  async *chatStream(req: ChatRequest): AsyncIterable<ChatChunk> {
    let emitted = false;
    try {
      for await (const event of this.query(req)) {
        if (isAssistantMessage(event)) {
          const text = extractText(event);
          if (text) {
            emitted = true;
            yield { text, done: false };
          }
        } else if (isResultMessage(event)) {
          if (event.subtype === 'error' || event.is_error) {
            throw new ChatProviderError(this.id, `Claude Code run failed: ${event.result || 'unknown error'}`);
          }
          if (!emitted && event.result) {
            yield { text: event.result, done: false };
          }
          yield { text: '', done: true };
          return;
        }
      }
    } catch (err) {
      if (err instanceof ChatProviderError) throw err;
      throw new ChatProviderError(this.id, `Claude Code call failed: ${(err as Error).message}`, err);
    }
    yield { text: '', done: true };
  }

  private query(req: ChatRequest) {
    return query({
      prompt: buildPrompt(req),
      options: {
        cwd: this.workDir,
        // Only project settings from the dedicated work dir — never the host's ~/.claude/settings.json.
        settingSources: ['project'],
        // Headless: no interactive terminal to answer permission prompts.
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Chat semantics: no tools, deterministic text in → text out.
        allowedTools: [],
        model: this.cfg.model,
        maxTurns: MAX_TURNS,
        systemPrompt: buildSystemPrompt(req),
      },
    });
  }
}

// --- helpers ---

function hasCredentials(): boolean {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return true;
  // Fallback: claude CLI OAuth login credentials (subscription users).
  return existsSync(join(homedir(), '.claude', '.credentials.json'));
}

function buildSystemPrompt(req: ChatRequest): string | undefined {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return system || undefined;
}

function buildPrompt(req: ChatRequest): string {
  const parts = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'assistant' ? `Assistant: ${m.content}` : m.content));
  return parts.join('\n\n') || 'Hi';
}

function isAssistantMessage(event: SDKMessage): event is SDKAssistantMessage {
  return event.type === 'assistant';
}

function isResultMessage(event: SDKMessage): event is SDKResultMessage {
  return event.type === 'result';
}

function extractText(event: SDKAssistantMessage): string {
  const content = event.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function modelFromUsage(event: SDKResultMessage, fallback: string): string {
  if (event.subtype !== 'success') return fallback;
  const keys = Object.keys(event.modelUsage ?? {});
  return keys[0] ?? fallback;
}

function sumUsage(modelUsage: SDKResultMessage['modelUsage']): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const usage of Object.values(modelUsage ?? {})) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  }
  return { inputTokens, outputTokens };
}
