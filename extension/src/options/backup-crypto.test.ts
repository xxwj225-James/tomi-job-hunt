import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from './backup-crypto.js';

const PAYLOAD = JSON.stringify({ tomihuntBackup: 1, 'tomihunt-llm-config': { apiKey: 'sk-secret' } });

describe('encrypted backup', () => {
  it('round-trips with the correct password', async () => {
    const backup = await encryptBackup(PAYLOAD, 'my-password');
    // ciphertext on disk must never contain the plaintext key
    expect(JSON.stringify(backup)).not.toContain('sk-secret');
    expect(await decryptBackup(backup, 'my-password')).toBe(PAYLOAD);
  });

  it('rejects the wrong password', async () => {
    const backup = await encryptBackup(PAYLOAD, 'right-password');
    await expect(decryptBackup(backup, 'wrong-password')).rejects.toThrow();
  });

  it('produces distinct ciphertexts for the same payload (random IV/salt)', async () => {
    const a = await encryptBackup(PAYLOAD, 'p');
    const b = await encryptBackup(PAYLOAD, 'p');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptBackup(a, 'p')).toBe(PAYLOAD);
    expect(await decryptBackup(b, 'p')).toBe(PAYLOAD);
  });
});
