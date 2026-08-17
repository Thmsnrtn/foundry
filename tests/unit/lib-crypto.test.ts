// =============================================================================
// FOUNDRY — Token Encryption Tests
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { encryptToken, decryptToken, isEncryptedToken, getPlaintextToken } from '../../src/lib/crypto.js';

describe('token encryption', () => {
  beforeAll(() => {
    // Ensure encryption key is set for tests
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests';
  });

  it('encrypts and decrypts a token roundtrip', () => {
    const token = 'ghp_abc123def456';
    const encrypted = encryptToken(token);
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(token);
  });

  it('produces different ciphertext for same plaintext (unique IVs)', () => {
    const token = 'ghp_same_token';
    const a = encryptToken(token);
    const b = encryptToken(token);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptToken(a)).toBe(token);
    expect(decryptToken(b)).toBe(token);
  });

  it('isEncryptedToken identifies encrypted format', () => {
    const encrypted = encryptToken('test');
    expect(isEncryptedToken(encrypted)).toBe(true);
    expect(isEncryptedToken('ghp_plain_text')).toBe(false);
    expect(isEncryptedToken('')).toBe(false);
  });

  it('decryptToken returns null for corrupted data', () => {
    expect(decryptToken('bad:data:here')).toBe(null);
    expect(decryptToken('not-encrypted')).toBe(null);
  });

  it('getPlaintextToken decrypts encrypted tokens', () => {
    const token = 'ghp_test_token';
    const encrypted = encryptToken(token);
    expect(getPlaintextToken(encrypted)).toBe(token);
  });

  it('getPlaintextToken passes through plaintext tokens', () => {
    expect(getPlaintextToken('ghp_plain_token')).toBe('ghp_plain_token');
  });

  it('getPlaintextToken returns null for null input', () => {
    expect(getPlaintextToken(null)).toBe(null);
  });

  it('handles empty string encryption', () => {
    const encrypted = encryptToken('');
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe('');
  });

  it('handles long tokens', () => {
    const longToken = 'ghp_' + 'a'.repeat(500);
    const encrypted = encryptToken(longToken);
    expect(decryptToken(encrypted)).toBe(longToken);
  });
});
