// =============================================================================
// FOUNDRY — Token Encryption
// Encrypts/decrypts sensitive tokens (GitHub access tokens) at rest.
// Uses AES-256-GCM with a key derived from ENCRYPTION_KEY env var.
// =============================================================================

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'foundry-token-encryption-v1'; // Static salt is fine; key derivation adds entropy

let _derivedKey: Buffer | null = null;
let _oldDerivedKey: Buffer | null = null;

function getDerivedKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.CLERK_SECRET_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY or CLERK_SECRET_KEY required for token encryption');
  _derivedKey = scryptSync(secret, SALT, 32);

  // Support key rotation: if OLD_ENCRYPTION_KEY is set, derive the old key for decryption fallback
  const oldSecret = process.env.OLD_ENCRYPTION_KEY;
  if (oldSecret) {
    _oldDerivedKey = scryptSync(oldSecret, SALT, 32);
  }

  return _derivedKey;
}

function getOldDerivedKey(): Buffer | null {
  getDerivedKey(); // ensure both keys are initialized
  return _oldDerivedKey;
}

/**
 * Encrypt a plaintext token. Returns a base64 string: iv:ciphertext:tag
 */
export function encryptToken(plaintext: string): string {
  const key = getDerivedKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`;
}

/**
 * Decrypt an encrypted token string (iv:ciphertext:tag format).
 * Returns null if decryption fails (corrupt or wrong key).
 */
export function decryptToken(encrypted: string): string | null {
  const parts = encrypted.split(':');
  if (parts.length !== 3) return null;

  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');

  // Try current key first
  try {
    const key = getDerivedKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Current key failed — try old key for rotation support
    const oldKey = getOldDerivedKey();
    if (oldKey) {
      try {
        const decipher = createDecipheriv(ALGORITHM, oldKey, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString('utf8');
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Check if a value looks like an encrypted token (iv:ciphertext:tag format).
 */
export function isEncryptedToken(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => {
    try { Buffer.from(p, 'base64'); return true; } catch { return false; }
  });
}

/**
 * Decrypt a token that may or may not be encrypted (migration-safe).
 * If it looks like an encrypted token, decrypt it. Otherwise return as-is.
 */
export function getPlaintextToken(stored: string | null): string | null {
  if (!stored) return null;
  if (isEncryptedToken(stored)) {
    return decryptToken(stored);
  }
  // Legacy plaintext token — return as-is
  return stored;
}
