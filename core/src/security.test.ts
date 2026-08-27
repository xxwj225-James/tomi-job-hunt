import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deleteSecret, dpapiDecrypt, dpapiEncrypt, readSecret, secretPath, writeSecret } from './security.js';
import { Logger } from './logger.js';

const silentLog = new Logger('error', 'test');

describe('secret store (DPAPI)', () => {
  it('round-trips the API key through the encrypted file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tomi-secret-'));
    try {
      await writeSecret(dir, 'sk-secret-test-123', silentLog);
      expect(existsSync(secretPath(dir))).toBe(true);
      const raw = readFileSync(secretPath(dir), 'utf8');
      // The blob must never contain the plaintext key.
      expect(raw).not.toContain('sk-secret-test-123');
      expect(await readSecret(dir)).toBe('sk-secret-test-123');
      deleteSecret(dir);
      expect(await readSecret(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dpapi primitives', () => {
  it('encrypt/decrypt round-trip', async () => {
    const encrypted = await dpapiEncrypt('hello-tomihunt');
    expect(encrypted).not.toContain('hello-tomihunt');
    expect(await dpapiDecrypt(encrypted)).toBe('hello-tomihunt');
  });
});
