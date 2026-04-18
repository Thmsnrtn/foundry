// =============================================================================
// Tests: Encryption Service (AES-256-GCM)
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to dynamically import so env stubs take effect before getKey() reads them
async function loadModule() {
  // Clear module cache to pick up new env values
  const mod = await import('../../src/services/encryption.js');
  return mod;
}

// A valid 64-hex-char key (32 bytes)
const TEST_KEY = 'a'.repeat(64);

describe('encryption service', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
    // Reset module cache so each test picks up fresh env
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('encrypt()', () => {
    it('produces different ciphertext for the same plaintext (random IV)', async () => {
      const { encrypt } = await loadModule();
      const plaintext = 'super-secret-token-12345';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      // Both should be valid format
      expect(encrypted1).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);
      expect(encrypted2).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i);

      // Must differ due to random IV
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('returns a string with three colon-separated hex parts', async () => {
      const { encrypt } = await loadModule();
      const result = encrypt('hello world');
      const parts = result.split(':');

      expect(parts).toHaveLength(3);
      // IV should be 12 bytes = 24 hex chars
      expect(parts[0]).toHaveLength(24);
      // Auth tag should be 16 bytes = 32 hex chars
      expect(parts[2]).toHaveLength(32);
    });

    it('throws if ENCRYPTION_KEY is missing', async () => {
      vi.stubEnv('ENCRYPTION_KEY', '');
      // Also try with deleted env
      delete process.env.ENCRYPTION_KEY;
      const { encrypt } = await loadModule();

      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY environment variable is not set');
    });

    it('throws if ENCRYPTION_KEY is wrong length', async () => {
      vi.stubEnv('ENCRYPTION_KEY', 'abcd1234'); // too short
      const { encrypt } = await loadModule();

      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be exactly 64 hex characters');
    });

    it('throws if ENCRYPTION_KEY has non-hex characters', async () => {
      vi.stubEnv('ENCRYPTION_KEY', 'g'.repeat(64)); // 'g' is not valid hex
      const { encrypt } = await loadModule();

      expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be exactly 64 hex characters');
    });
  });

  describe('decrypt()', () => {
    it('roundtrips: decrypt(encrypt(text)) returns original text', async () => {
      const { encrypt, decrypt } = await loadModule();
      const originals = [
        'simple text',
        '',
        'unicode: ñ ü ö 中文 🎉',
        'a'.repeat(10000), // large payload
        'special chars: !@#$%^&*()_+-=[]{}|;:,.<>?',
        'newlines\nand\ttabs',
      ];

      for (const original of originals) {
        const encrypted = encrypt(original);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(original);
      }
    });

    it('throws on malformed input — missing parts', async () => {
      const { decrypt } = await loadModule();

      expect(() => decrypt('not-valid')).toThrow('Invalid encrypted value format');
      expect(() => decrypt('only:two')).toThrow('Invalid encrypted value format');
      expect(() => decrypt('')).toThrow('Invalid encrypted value format');
    });

    it('throws on tampered ciphertext (auth tag mismatch)', async () => {
      const { encrypt, decrypt } = await loadModule();
      const encrypted = encrypt('tamper test');
      const parts = encrypted.split(':');
      // Flip a character in the ciphertext
      const tampered = parts[0] + ':' + 'ff' + parts[1].slice(2) + ':' + parts[2];

      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws on tampered auth tag', async () => {
      const { encrypt, decrypt } = await loadModule();
      const encrypted = encrypt('auth tag test');
      const parts = encrypted.split(':');
      // Replace auth tag with different value
      const tampered = parts[0] + ':' + parts[1] + ':' + '0'.repeat(32);

      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('isEncrypted()', () => {
    it('returns true for valid encrypted format', async () => {
      const { encrypt, isEncrypted } = await loadModule();
      const encrypted = encrypt('test value');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('returns true for hex:hex:hex pattern', async () => {
      const { isEncrypted } = await loadModule();
      expect(isEncrypted('aabb:ccdd:eeff')).toBe(true);
      expect(isEncrypted('0123456789abcdef:aabb:ccdd')).toBe(true);
    });

    it('returns false for plaintext strings', async () => {
      const { isEncrypted } = await loadModule();
      expect(isEncrypted('sk_live_abc123')).toBe(false);
      expect(isEncrypted('just a regular string')).toBe(false);
      expect(isEncrypted('no-colons-but-hex')).toBe(false);
    });

    it('returns false for strings with non-hex characters between colons', async () => {
      const { isEncrypted } = await loadModule();
      expect(isEncrypted('xyz:abc:def')).toBe(false); // not all hex when pattern checks
      // Actually 'abc' and 'def' are valid hex. Let's use truly non-hex:
      expect(isEncrypted('gggg:hhhh:iiii')).toBe(false);
    });

    it('returns false for empty string', async () => {
      const { isEncrypted } = await loadModule();
      expect(isEncrypted('')).toBe(false);
    });

    it('returns false for strings with extra colons', async () => {
      const { isEncrypted } = await loadModule();
      expect(isEncrypted('aa:bb:cc:dd')).toBe(false);
    });
  });
});
