/**
 * Provider credential detection — dependency-free, so core can probe Claude
 * readiness at startup without loading the (optional) Claude SDK modules.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** True when any Anthropic credential source is available (env or CLI login). */
export function hasClaudeCredentials(): boolean {
  const env = process.env;
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return true;
  // Fallback: claude CLI OAuth login credentials (subscription users).
  return existsSync(join(homedir(), '.claude', '.credentials.json'));
}
