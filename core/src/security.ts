/**
 * API key protection — encrypted at rest with Windows DPAPI (CurrentUser
 * scope): decryptable only by the same Windows user on the same machine.
 * A copied file is useless elsewhere. Zero native deps: DPAPI is invoked
 * via PowerShell (present on every Windows 10/11).
 *
 * Non-Windows fallback: the secret file holds base64 plaintext with 0600
 * permissions and a warning is logged (the target market is Windows).
 */
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from './logger.js';

const execFileAsync = promisify(execFile);

export const SECRET_FILE = 'api-key.enc';

const PS_ENCRYPT = (b64: string) => `
Add-Type -AssemblyName System.Security
$bytes = [System.Convert]::FromBase64String('${b64}')
$out = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
[System.Convert]::ToBase64String($out)`;

const PS_DECRYPT = (b64: string) => `
Add-Type -AssemblyName System.Security
$bytes = [System.Convert]::FromBase64String('${b64}')
$out = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
[System.Text.Encoding]::UTF8.GetString($out)`;

function toB64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

async function runPowerShell(script: string): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 },
  );
  return stdout.trim();
}

export async function dpapiEncrypt(text: string): Promise<string> {
  if (process.platform !== 'win32') return toB64(text); // fallback: plaintext base64
  return runPowerShell(PS_ENCRYPT(toB64(text)));
}

export async function dpapiDecrypt(blob: string): Promise<string> {
  if (process.platform !== 'win32') {
    return Buffer.from(blob, 'base64').toString('utf8');
  }
  return runPowerShell(PS_DECRYPT(blob));
}

// --- Secret file handling (never inside config.json) ---

export function secretPath(configDir: string): string {
  return join(configDir, SECRET_FILE);
}

/** Reads + decrypts the stored key. Returns undefined when absent. */
export async function readSecret(configDir: string): Promise<string | undefined> {
  const path = secretPath(configDir);
  if (!existsSync(path)) return undefined;
  try {
    const blob = readFileSync(path, 'utf8').trim();
    if (!blob) return undefined;
    const key = await dpapiDecrypt(blob);
    return key || undefined;
  } catch {
    return undefined; // undecryptable (e.g. different user/machine) — treat as absent
  }
}

/** Encrypts + writes the key to the secret file (outside config.json). */
export async function writeSecret(configDir: string, apiKey: string, log: Logger): Promise<void> {
  mkdirSync(configDir, { recursive: true });
  const path = secretPath(configDir);
  const blob = await dpapiEncrypt(apiKey);
  writeFileSync(path, blob, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort
    }
    log.warn('security: non-Windows fallback — api-key.enc holds base64 (set file permissions accordingly)');
  }
}

export function deleteSecret(configDir: string): void {
  rmSync(secretPath(configDir), { force: true });
}
