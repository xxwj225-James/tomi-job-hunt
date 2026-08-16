/**
 * Configuration loading.
 *
 * Priority (low → high):
 *   1. Defaults below
 *   2. ~/.tomi-job-hunt/config.json  (or $TOMI_HOME/config.json)
 *   3. Environment variables (TOMI_PROVIDER, TOMI_MODEL, TOMI_PORT, ...)
 *   4. .env file in the process cwd (via process.loadEnvFile, best-effort)
 *
 * API keys never live in the repo — see docs/privacy.md.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import * as nodeProcess from 'node:process';
import { z } from 'zod';
import type { LLMConfig, ProviderId } from './types.js';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude-code',
  'claude-api',
  'deepseek',
  'kimi',
  'qwen',
  'openai-compatible',
];

/** Known OpenAI-compatible endpoints (verified against TomiLite's integration). */
export const PROVIDER_PRESETS: Record<string, { baseUrl: string; defaultModel?: string }> = {
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-flash' },
  kimi: { baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3.7-plus' },
};

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderId, string | undefined> = {
  'claude-code': 'claude-sonnet-5',
  'claude-api': 'claude-sonnet-5',
  deepseek: PROVIDER_PRESETS.deepseek?.defaultModel,
  kimi: PROVIDER_PRESETS.kimi?.defaultModel,
  qwen: PROVIDER_PRESETS.qwen?.defaultModel,
  'openai-compatible': undefined, // must be set explicitly
};

const PROVIDER_ENUM = [
  'claude-code',
  'claude-api',
  'deepseek',
  'kimi',
  'qwen',
  'openai-compatible',
] as const;

const fileConfigSchema = z.object({
  provider: z.enum(PROVIDER_ENUM).optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  thinking: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  // Decentralized intel network (Phase 5) — all optional
  intel: z
    .object({
      nostr: z
        .object({
          relays: z.array(z.string()).max(10).default([]),
          /** hex private key (nsec) — use a DEDICATED key, never a personal one */
          privateKey: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export interface AppConfig {
  llm: LLMConfig;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Directory where config.json was loaded from (default ~/.tomi-job-hunt). */
  configDir: string;
  intel: {
    nostr?: { relays: string[]; privateKey?: string };
  };
}

/** Resolves ~/.tomi-job-hunt, overridable with TOMI_HOME (mainly for tests). */
export function configDir(home: string = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return env.TOMI_HOME ?? join(home, '.tomi-job-hunt');
}

/** Loads .env from the cwd if present. Never throws. */
export function loadDotEnv(cwd: string = process.cwd()): void {
  try {
    // loadEnvFile exists since Node 20.12; namespace access stays safe on older 20.x
    const { loadEnvFile } = nodeProcess;
    if (typeof loadEnvFile === 'function') {
      loadEnvFile(join(cwd, '.env'));
    }
  } catch {
    // .env is optional; config.json and real env vars cover the rest
  }
}

export function loadConfig(options?: {
  home?: string;
  env?: NodeJS.ProcessEnv;
}): AppConfig {
  const env = options?.env ?? process.env;
  const dir = configDir(options?.home, env);

  let file: z.infer<typeof fileConfigSchema> = {};
  const path = join(dir, 'config.json');
  if (existsSync(path)) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new Error(`Failed to parse ${path}: ${(err as Error).message}`);
    }
    const parsed = fileConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid ${path}: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    file = parsed.data;
  }

  const provider: ProviderId = (env.TOMI_PROVIDER ?? file.provider ?? 'claude-code') as ProviderId;
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(
      `Unknown TOMI_PROVIDER "${provider}". Valid: ${PROVIDER_IDS.join(', ')}`,
    );
  }

  const model = env.TOMI_MODEL ?? file.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];
  const apiKey = env.ANTHROPIC_API_KEY ?? env.TOMI_API_KEY ?? file.apiKey;
  const baseUrl = env.TOMI_BASE_URL ?? file.baseUrl ?? PROVIDER_PRESETS[provider]?.baseUrl;

  const llm: LLMConfig = {
    provider,
    model,
    apiKey,
    baseUrl,
    thinking: file.thinking,
    maxTokens: file.maxTokens,
    temperature: file.temperature,
    concurrency: intEnv(env.TOMI_CONCURRENCY) ?? file.concurrency ?? 2,
  };

  return {
    llm,
    port: intEnv(env.TOMI_PORT) ?? file.port ?? 3000,
    logLevel: (env.TOMI_LOG_LEVEL ?? file.logLevel ?? 'info') as AppConfig['logLevel'],
    configDir: dir,
    intel: {
      nostr: file.intel?.nostr,
    },
  };
}

function intEnv(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
