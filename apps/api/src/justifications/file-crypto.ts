import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function getFileEncKey(): string {
  const key = process.env.FILE_ENC_KEY;
  if (!key) throw new Error('FILE_ENC_KEY env var requerida para cifrado de archivos');
  if (!/^[0-9a-fA-F]{64}$/.test(key))
    throw new Error('FILE_ENC_KEY debe ser exactamente 64 hex chars (32 bytes)');
  return key;
}

/** Cifra un buffer. Retorna ciphertext+tag y el IV en hex. */
export function encryptBuffer(data: Buffer, keyHex: string): { encrypted: Buffer; iv: string } {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  // formato en disco: [ciphertext][tag_16]
  const encrypted = Buffer.concat([ciphertext, tag]);
  return { encrypted, iv: iv.toString('hex') };
}

/** Descifra un buffer cifrado con encryptBuffer. Lanza si el tag no coincide. */
export function decryptBuffer(encrypted: Buffer, ivHex: string, keyHex: string): Buffer {
  if (encrypted.length < TAG_BYTES) throw new Error('Buffer cifrado demasiado pequeño');
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = encrypted.subarray(encrypted.length - TAG_BYTES);
  const ciphertext = encrypted.subarray(0, encrypted.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
