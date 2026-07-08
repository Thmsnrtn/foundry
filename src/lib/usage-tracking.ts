// =============================================================================
// FOUNDRY — AI Token Usage Tracking
// Tracks per-product token spend for cost monitoring and budget enforcement.
// =============================================================================

import { query } from '../db/client.js';
import { nanoid } from 'nanoid';
import { log } from './logger.js';
import type { AIResponse } from '../types/ai.js';

// Approximate pricing per 1M tokens. Keys match the AIResponse.model values
// (OpenRouter slugs, anthropic/ prefixed) so lookups actually hit.
const PRICING: Record<string, { input: number; output: number; cache_read: number }> = {
  'anthropic/claude-opus-4-8':   { input: 15.0,  output: 75.0, cache_read: 1.5 },
  'anthropic/claude-sonnet-5':   { input: 3.0,   output: 15.0, cache_read: 0.3 },
  'anthropic/claude-haiku-4-5':  { input: 1.0,   output: 5.0,  cache_read: 0.1 },
};

/**
 * Record token usage from an AI response, linked to a product.
 */
export async function trackUsage(
  productId: string,
  response: AIResponse,
  callType: string,
): Promise<void> {
  try {
    const pricing = PRICING[response.model] ?? PRICING['anthropic/claude-sonnet-5'];
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = response.usage.cache_creation_input_tokens ?? 0;

    // Calculate cost in cents
    const inputCost = ((inputTokens - cacheRead) / 1_000_000) * pricing.input * 100;
    const outputCost = (outputTokens / 1_000_000) * pricing.output * 100;
    const cacheCost = (cacheRead / 1_000_000) * pricing.cache_read * 100;
    const totalCostCents = Math.round(inputCost + outputCost + cacheCost);

    await query(
      `INSERT INTO ai_usage_log (id, product_id, model, call_type, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, response.model, callType, inputTokens, outputTokens, cacheRead, cacheCreation, totalCostCents, new Date().toISOString()]
    );
  } catch (err) {
    // Don't let usage tracking errors break the main flow
    log.warn('Failed to track AI usage', { error: err instanceof Error ? err.message : String(err), productId, callType });
  }
}

/**
 * Get usage summary for a product within a date range.
 */
export async function getUsageSummary(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<{ total_input_tokens: number; total_output_tokens: number; total_cache_read_tokens: number; total_cost_cents: number; call_count: number }> {
  const result = await query(
    `SELECT
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(cache_read_tokens), 0) as total_cache_read_tokens,
       COALESCE(SUM(cost_cents), 0) as total_cost_cents,
       COUNT(*) as call_count
     FROM ai_usage_log
     WHERE product_id = ? AND created_at BETWEEN ? AND ?`,
    [productId, startDate, endDate]
  );
  const row = result.rows[0] as Record<string, number>;
  return {
    total_input_tokens: row.total_input_tokens ?? 0,
    total_output_tokens: row.total_output_tokens ?? 0,
    total_cache_read_tokens: row.total_cache_read_tokens ?? 0,
    total_cost_cents: row.total_cost_cents ?? 0,
    call_count: row.call_count ?? 0,
  };
}
