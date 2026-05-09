// =============================================================================
// FOUNDRY — Envelope Encryption (AES-256-GCM)
// =============================================================================
// Encrypts sensitive tokens/credentials at rest.
// ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars) in the environment.
// Format: iv:ciphertext:authTag (all hex-encoded)
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const HEX_PATTERN = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

function getKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'It must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  if (keyHex.length !== 64 || !/^[0-9a-f]+$/i.test(keyHex)) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ' +
      `Got ${keyHex.length} characters.`
    );
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a string in the format: iv:ciphertext:authTag (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt a string in the format: iv:ciphertext:authTag (all hex-encoded).
 * Returns the original plaintext.
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format. Expected iv:ciphertext:authTag');
  }

  const [ivHex, ciphertextHex, authTagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check whether a value looks like an encrypted string (iv:ciphertext:authTag, all hex).
 * Useful for detecting whether a token has already been encrypted or is still plaintext.
 */
export function isEncrypted(value: string): boolean {
  return HEX_PATTERN.test(value);
}

/**
 * Encrypt a credential JSON payload (e.g. integrations.credentials_json).
 * Idempotent: if the value is already encrypted, returns it unchanged so
 * callers can safely round-trip through this helper. Returns null for
 * null/empty inputs so the caller's NULL semantics are preserved.
 */
export function encryptCredentialPayload(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

/**
 * Decrypt a credential JSON payload. Backward compatible with plaintext
 * rows that pre-date encryption: if the value isn't recognizably encrypted,
 * returns it as-is. Returns null for null/empty inputs.
 */
export function decryptCredentialPayload(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isEncrypted(value)) return value;
  return decrypt(value);
}
