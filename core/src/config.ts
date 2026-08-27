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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as nodeProcess from 'node:process';
import { z } from 'zod';
import { deleteSecret, readSecret, secretPath, writeSecret } from './security.js';
import type { Logger } from './logger.js';
import type { LLMConfig, ProviderId } from './types.js';

/** Default listen port — a cold port on purpose. 3000 collides with
 *  dev servers all the time; ordinary users must never see a port number. */
export const DEFAULT_PORT = 34567;
/** Ports to try when the base port is taken (user-configured ports are used
 *  verbatim — never silently shifted). */
export const PORT_RETRIES = 4;

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
  baseUrl: z.string().optional(),
  thinking: z.boolean().optional(),
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

export async function loadConfig(options?: {
  home?: string;
  env?: NodeJS.ProcessEnv;
  /** Silent migration logger (tests pass a silent one). */
  log?: Logger;
}): Promise<AppConfig> {
  const env = options?.env ?? process.env;
  const dir = configDir(options?.home, env);

  let file: z.infer<typeof fileConfigSchema> = {};
  let rawFile: Record<string, unknown> = {};
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
    rawFile = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  }

  const provider: ProviderId = (env.TOMI_PROVIDER ?? file.provider ?? 'claude-code') as ProviderId;
  if (!PROVIDER_IDS.includes(provider)) {
    throw new Error(
      `Unknown TOMI_PROVIDER "${provider}". Valid: ${PROVIDER_IDS.join(', ')}`,
    );
  }

  const model = env.TOMI_MODEL ?? file.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];

  // The API key NEVER lives in config.json. It is encrypted at rest in
  // <configDir>/api-key.enc (Windows DPAPI, CurrentUser scope).
  let apiKey = env.ANTHROPIC_API_KEY ?? env.TOMI_API_KEY ?? (await readSecret(dir));

  // Legacy migration: an apiKey field left over in config.json (pre-0.1.x)
  // is moved into the encrypted store and stripped from the file.
  const legacyKey = typeof rawFile.apiKey === 'string' ? rawFile.apiKey : undefined;
  if (!apiKey && legacyKey) {
    apiKey = legacyKey;
    await writeSecret(dir, legacyKey, options?.log ?? silentLog());
    delete rawFile.apiKey;
    try {
      writeFileSync(path, `${JSON.stringify(rawFile, null, 2)}
`, 'utf8');
    } catch {
      // stripping best-effort; the encrypted copy already exists
    }
    options?.log?.warn('config: migrated legacy apiKey out of config.json into the encrypted store');
  }

  const baseUrl = env.TOMI_BASE_URL ?? file.baseUrl ?? PROVIDER_PRESETS[provider]?.baseUrl;

  const llm: LLMConfig = {
    provider,
    model,
    apiKey,
    baseUrl,
    thinking: file.thinking,
    temperature: file.temperature,
    concurrency: intEnv(env.TOMI_CONCURRENCY) ?? file.concurrency ?? 2,
  };

  return {
    llm,
    port: intEnv(env.TOMI_PORT) ?? file.port ?? DEFAULT_PORT,
    logLevel: (env.TOMI_LOG_LEVEL ?? file.logLevel ?? 'info') as AppConfig['logLevel'],
    configDir: dir,
    intel: {
      nostr: file.intel?.nostr,
    },
  };
}

function silentLog(): Logger {
  // Minimal inline logger to avoid a circular import in the migration path.
  return { child: () => silentLog(), debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger;
}

function intEnv(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

// --- Config file writing (used by the /setup wizard) ---

export type ConfigFilePatch = Partial<{
  provider: ProviderId;
  model: string;
  /** Empty string leaves the stored key untouched; set clearApiKey to erase it. */
  apiKey: string;
  baseUrl: string;
  thinking: boolean;
  temperature: number;
  concurrency: number;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}> & {
  /** Erase the stored API key entirely (ignores apiKey). */
  clearApiKey?: boolean;
};

/** Reads the raw config.json object, or {} when missing/unparseable. */
export function readConfigFile(dir: string): Record<string, unknown> {
  const path = join(dir, 'config.json');
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Merges a patch into config.json (unknown fields such as `intel` are
 * preserved), validates the result, and writes it back. Returns the merged
 * raw object. Throws on invalid values.
 */
export async function saveConfigFile(
  dir: string,
  patch: ConfigFilePatch,
  log?: Logger,
): Promise<Record<string, unknown>> {
  const current = readConfigFile(dir);
  const next: Record<string, unknown> = { ...current };

  for (const key of [
    'provider',
    'model',
    'baseUrl',
    'thinking',
    'temperature',
    'concurrency',
    'port',
    'logLevel',
  ] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }

  // A blank model/baseUrl means "use the provider default" — drop the stored
  // value so loadConfig falls back to the preset.
  if (patch.model !== undefined && String(next.model).trim() === '') delete next.model;
  if (patch.baseUrl !== undefined && String(next.baseUrl).trim() === '') delete next.baseUrl;

  // The API key NEVER touches config.json — it lives in the DPAPI-encrypted
  // secret file. A legacy key still sitting in the file is migrated to the
  // secret store instead of being dropped.
  const legacyKey = typeof next.apiKey === 'string' && next.apiKey.trim() !== '' ? next.apiKey.trim() : undefined;
  delete next.apiKey;
  if (patch.clearApiKey) {
    deleteSecret(dir);
  } else if (patch.apiKey !== undefined && patch.apiKey.trim() !== '') {
    await writeSecret(dir, patch.apiKey.trim(), log ?? silentLog());
  } else if (legacyKey) {
    await writeSecret(dir, legacyKey, log ?? silentLog());
  }

  // Validate before persisting: reuse the same schema as loadConfig.
  const parsed = fileConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}
