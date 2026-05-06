import { describe, it, expect, beforeEach } from 'vitest';
import { encryptBuffer, decryptBuffer, getFileEncKey } from './file-crypto.js';

describe('file-crypto', () => {
  const KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes

  beforeEach(() => {
    process.env.FILE_ENC_KEY = KEY;
  });

  it('encrypt then decrypt returns original buffer', () => {
    const original = Buffer.from('certificado médico simulado');
    const { encrypted, iv } = encryptBuffer(original, KEY);
    const decrypted = decryptBuffer(encrypted, iv, KEY);
    expect(decrypted).toEqual(original);
  });

  it('encrypted buffer is different from original', () => {
    const original = Buffer.from('datos privados');
    const { encrypted } = encryptBuffer(original, KEY);
    expect(encrypted.equals(original)).toBe(false);
  });

  it('tampered ciphertext throws on decrypt', () => {
    const original = Buffer.from('datos privados');
    const { encrypted, iv } = encryptBuffer(original, KEY);
    if (encrypted[0] === undefined) throw new Error('empty buffer');
    encrypted[0] ^= 0xff;
    expect(() => decryptBuffer(encrypted, iv, KEY)).toThrow();
  });

  it('getFileEncKey throws if env var missing', () => {
    delete process.env.FILE_ENC_KEY;
    expect(() => getFileEncKey()).toThrow(/FILE_ENC_KEY/);
  });

  it('getFileEncKey throws if env var wrong length', () => {
    process.env.FILE_ENC_KEY = 'tooshort';
    expect(() => getFileEncKey()).toThrow(/64 hex/);
  });
});
