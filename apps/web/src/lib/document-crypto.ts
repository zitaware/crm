/**
 * Client-side AES-256-GCM document encryption (Web Crypto API). The server
 * never receives, stores, or verifies the password — a wrong password just
 * fails to decrypt (GCM's built-in authentication-tag check *is* the
 * password verification). There is no recovery path if the password is
 * lost: the server has no means to decrypt, ever, for anyone.
 */

const PBKDF2_ITERATIONS = 600_000; // current OWASP baseline for PBKDF2-HMAC-SHA256
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12; // NIST-recommended size for AES-GCM

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptFile(
  file: File,
  password: string,
): Promise<{ ciphertext: ArrayBuffer; salt: Uint8Array; iv: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const key = await deriveKey(password, salt);
  const plaintext = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext);
  return { ciphertext, salt, iv };
}

/** Throws if the password is wrong (AES-GCM authentication-tag mismatch). */
export async function decryptToBlob(
  ciphertext: ArrayBuffer,
  password: string,
  salt: Uint8Array,
  iv: Uint8Array,
  contentType: string,
): Promise<Blob> {
  const key = await deriveKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext);
  return new Blob([plaintext], { type: contentType });
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
