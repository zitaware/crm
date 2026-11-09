import { describe, expect, it } from 'vitest';
import { decryptToBlob, encryptFile, fromBase64, toBase64 } from './document-crypto';

function makeFile(content: string, name = 'test.txt', type = 'text/plain'): File {
  return new File([content], name, { type });
}

describe('document-crypto', () => {
  it('round-trips: encrypt then decrypt with the correct password reproduces the original bytes', async () => {
    const original = 'Some confidential tender content — ₹1,80,00,000.';
    const file = makeFile(original, 'tender.txt', 'text/plain');

    const { ciphertext, salt, iv } = await encryptFile(file, 'correct-horse-battery-staple');
    const blob = await decryptToBlob(ciphertext, 'correct-horse-battery-staple', salt, iv, 'text/plain');
    const decrypted = await blob.text();

    expect(decrypted).toBe(original);
    expect(blob.type).toBe('text/plain');
  });

  it('rejects the wrong password', async () => {
    const file = makeFile('secret content');
    const { ciphertext, salt, iv } = await encryptFile(file, 'the-real-password');

    await expect(decryptToBlob(ciphertext, 'a-wrong-password', salt, iv, 'text/plain')).rejects.toThrow();
  });

  it('produces different ciphertext for the same file+password on separate encryptions (random salt/iv)', async () => {
    const file = makeFile('identical content');
    const first = await encryptFile(file, 'same-password');
    const second = await encryptFile(file, 'same-password');

    expect(toBase64(first.salt)).not.toBe(toBase64(second.salt));
    expect(toBase64(first.iv)).not.toBe(toBase64(second.iv));
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });

  it('base64 round-trips arbitrary byte arrays', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
