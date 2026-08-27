/**
 * Password-encrypted backups — the export file may contain an API key, so
 * it must never be plaintext JSON. AES-256-GCM via WebCrypto with a
 * PBKDF2-derived key (100k iterations). Zero dependencies; pure functions
 * so they're testable in Node.
 */

export interface EncryptedBackup {
  format: 'tomihunt-backup-encrypted';
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

const ITERATIONS = 100_000;

function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromB64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(json: string, password: string): Promise<EncryptedBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(json),
  );
  return {
    format: 'tomihunt-backup-encrypted',
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(new Uint8Array(ciphertext)),
  };
}

export async function decryptBackup(backup: EncryptedBackup, password: string): Promise<string> {
  const salt = fromB64(backup.salt);
  const iv = fromB64(backup.iv);
  const key = await deriveKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    fromB64(backup.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
