// =============================================================================
// Tests: AI Client — Cost Tracking & Utilities
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('AI client cost tracking', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test-key');
    vi.stubEnv('AI_DAILY_COST_CEILING_CENTS', '2500'); // $25
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadModule() {
    return import('../../src/services/ai/client.js');
  }

  describe('getDailySpend()', () => {
    it('returns 0 for unknown product', async () => {
      const { getDailySpend } = await loadModule();
      expect(await getDailySpend('nonexistent-product')).toBe(0);
    });

    it('returns 0 for a product with no recorded spend', async () => {
      const { getDailySpend } = await loadModule();
      expect(await getDailySpend('brand-new-product')).toBe(0);
    });
  });

  describe('isCostCeilingReached()', () => {
    it('returns false when no spend recorded (under limit)', async () => {
      const { isCostCeilingReached } = await loadModule();
      expect(await isCostCeilingReached('fresh-product')).toBe(false);
    });

    it('returns false for unknown product', async () => {
      const { isCostCeilingReached } = await loadModule();
      expect(await isCostCeilingReached('unknown-product-id')).toBe(false);
    });

    it('returns false with no product id (global scope only)', async () => {
      const { isCostCeilingReached } = await loadModule();
      expect(await isCostCeilingReached()).toBe(false);
    });
  });

  describe('parseJSONResponse()', () => {
    it('parses raw JSON', async () => {
      const { parseJSONResponse } = await loadModule();
      const result = parseJSONResponse<{ name: string }>('{"name":"test"}');
      expect(result).toEqual({ name: 'test' });
    });

    it('strips ```json code fences', async () => {
      const { parseJSONResponse } = await loadModule();
      const input = '```json\n{"key":"value"}\n```';
      const result = parseJSONResponse<{ key: string }>(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('strips plain ``` code fences', async () => {
      const { parseJSONResponse } = await loadModule();
      const input = '```\n{"key":"value"}\n```';
      const result = parseJSONResponse<{ key: string }>(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('handles leading/trailing whitespace', async () => {
      const { parseJSONResponse } = await loadModule();
      const input = '  \n  {"items":[1,2,3]}  \n  ';
      const result = parseJSONResponse<{ items: number[] }>(input);
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('throws on invalid JSON', async () => {
      const { parseJSONResponse } = await loadModule();
      expect(() => parseJSONResponse('not json at all')).toThrow();
    });

    it('parses nested objects from code fences', async () => {
      const { parseJSONResponse } = await loadModule();
      const input = '```json\n{"a":{"b":{"c":true}}}\n```';
      const result = parseJSONResponse<{ a: { b: { c: boolean } } }>(input);
      expect(result.a.b.c).toBe(true);
    });

    it('handles code fence with no language specifier and trailing fence', async () => {
      const { parseJSONResponse } = await loadModule();
      const input = '```\n[1,2,3]\n```';
      const result = parseJSONResponse<number[]>(input);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('MODELS constant', () => {
    it('exports correct model identifiers', async () => {
      const { MODELS } = await loadModule();
      expect(MODELS.OPUS).toBe('anthropic/claude-opus-4-6');
      expect(MODELS.SONNET).toBe('anthropic/claude-sonnet-4-5-20250929');
    });
  });
});
