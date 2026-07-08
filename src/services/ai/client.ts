// =============================================================================
// FOUNDRY — AI Client (OpenRouter)
// Routes all LLM calls through OpenRouter for cost efficiency and model flexibility.
// Supports Claude, GPT, and any OpenRouter-available model via config.
// =============================================================================

import { z } from 'zod';
import type { AIModel, AICallConfig, AIResponse } from '../../types/ai.js';
import { log } from '../../lib/logger.js';
import { reportError } from '../../lib/error-reporter.js';
import { query } from '../../db/client.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const MODELS = {
  // Strategic / methodology — highest quality, used for audit scoring, weekly synthesis
  OPUS: 'anthropic/claude-opus-4-8' as AIModel,
  // Operational / fast — used for agent runs, briefings, competitive scans
  SONNET: 'anthropic/claude-sonnet-5' as AIModel,
  // Cheap classification — scratchpad analysis, relevance scoring, injection screening
  HAIKU: 'anthropic/claude-haiku-4-5' as AIModel,
} as const;

// ─── Cost Ceiling ────────────────────────────────────────────────────────────
// Daily AI spend caps at three scopes: per-product, per-founder (fleet), and
// global. Spend is PERSISTED to the ai_daily_spend table so it survives deploys
// and is shared across machines — the in-process Map is only a read-through
// cache (short TTL) so we don't hit the DB on every one of the 73 AI crons.
//
//   product default $25/day  (AI_DAILY_COST_CEILING_CENTS)
//   founder default $100/day (AI_DAILY_COST_CEILING_FOUNDER_CENTS)
//   global  default $500/day (AI_DAILY_COST_CEILING_GLOBAL_CENTS)
const DAILY_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10);
const FOUNDER_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_FOUNDER_CENTS ?? '10000', 10);
const GLOBAL_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_GLOBAL_CENTS ?? '50000', 10);

const GLOBAL_SCOPE_ID = '__global__';
const CACHE_TTL_MS = 60_000; // re-read from DB at most once per minute per scope

type Scope = 'product' | 'founder' | 'global';

// Read-through cache: `${scope}:${scopeId}:${date}` -> { cents, readAt }
const spendCache = new Map<string, { cents: number; readAt: number }>();
// productId -> founderId, to enforce the per-founder cap without a lookup per call
const productOwnerCache = new Map<string, string>();

function utcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function cacheKey(scope: Scope, scopeId: string, date: string): string {
  return `${scope}:${scopeId}:${date}`;
}

async function resolveFounderId(productId: string): Promise<string | null> {
  const cached = productOwnerCache.get(productId);
  if (cached) return cached;
  try {
    const res = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
    const owner = res.rows.length ? String((res.rows[0] as Record<string, unknown>).owner_id) : null;
    if (owner) productOwnerCache.set(productId, owner);
    return owner;
  } catch (err) {
    log.warn('ai_spend.owner_lookup_failed', { productId, error: (err as Error).message });
    return null;
  }
}

/** Read today's spend for a scope, using the DB as source of truth (cached). */
async function readScopeSpend(scope: Scope, scopeId: string): Promise<number> {
  const date = utcDate();
  const key = cacheKey(scope, scopeId, date);
  const cached = spendCache.get(key);
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.cents;
  try {
    const res = await query(
      'SELECT spent_cents FROM ai_daily_spend WHERE scope = ? AND scope_id = ? AND date = ?',
      [scope, scopeId, date],
    );
    const cents = res.rows.length ? Number((res.rows[0] as Record<string, unknown>).spent_cents) : 0;
    spendCache.set(key, { cents, readAt: Date.now() });
    return cents;
  } catch (err) {
    // On DB error, fall back to any cached value (fail-open — never block AI on a read error)
    log.warn('ai_spend.read_failed', { scope, scopeId, error: (err as Error).message });
    return cached?.cents ?? 0;
  }
}

/** Atomically add spend to a scope's daily row and update the cache optimistically. */
async function incrementScopeSpend(scope: Scope, scopeId: string, costCents: number): Promise<void> {
  const date = utcDate();
  const now = new Date().toISOString();
  await query(
    `INSERT INTO ai_daily_spend (scope, scope_id, date, spent_cents, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope, scope_id, date)
     DO UPDATE SET spent_cents = spent_cents + excluded.spent_cents, updated_at = excluded.updated_at`,
    [scope, scopeId, date, costCents, now],
  );
  const key = cacheKey(scope, scopeId, date);
  const cached = spendCache.get(key);
  // Optimistic bump; keep readAt so the entry still expires and re-syncs from DB.
  spendCache.set(key, { cents: (cached?.cents ?? 0) + costCents, readAt: cached?.readAt ?? 0 });
}

// ─── Model-Specific Pricing (per 1M tokens, in USD) ─────────────────────────
// OpenRouter pricing. Configurable via environment variables.
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'anthropic/claude-opus-4-8': {
    input: parseFloat(process.env.AI_COST_OPUS_INPUT_PER_1M ?? '15.00'),
    output: parseFloat(process.env.AI_COST_OPUS_OUTPUT_PER_1M ?? '75.00'),
  },
  'anthropic/claude-sonnet-5': {
    input: parseFloat(process.env.AI_COST_SONNET_INPUT_PER_1M ?? '3.00'),
    output: parseFloat(process.env.AI_COST_SONNET_OUTPUT_PER_1M ?? '15.00'),
  },
  'anthropic/claude-haiku-4-5': {
    input: parseFloat(process.env.AI_COST_HAIKU_INPUT_PER_1M ?? '1.00'),
    output: parseFloat(process.env.AI_COST_HAIKU_OUTPUT_PER_1M ?? '5.00'),
  },
};

/**
 * Compute cost in cents for a given model and token usage.
 */
export function computeCostCents(model: AIModel | string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1M[model] ?? { input: 3.0, output: 15.0 }; // Default to Sonnet rates
  const inputCostCents = (inputTokens * rates.input) / 10_000;
  const outputCostCents = (outputTokens * rates.output) / 10_000;
  return inputCostCents + outputCostCents;
}

async function recordSpend(
  productId: string | undefined,
  model: AIModel | string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const costCents = computeCostCents(model, inputTokens, outputTokens);
  if (costCents <= 0) return;
  try {
    // Global scope is always tracked, even for product-less system calls.
    await incrementScopeSpend('global', GLOBAL_SCOPE_ID, costCents);
    if (productId) {
      await incrementScopeSpend('product', productId, costCents);
      const founderId = await resolveFounderId(productId);
      if (founderId) await incrementScopeSpend('founder', founderId, costCents);
    }
  } catch (err) {
    // Never fail a completed AI call because spend accounting hiccupped.
    log.warn('ai_spend.record_failed', { productId, error: (err as Error).message });
  }
}

/** Today's persisted product-level spend in cents. */
export async function getDailySpend(productId: string): Promise<number> {
  return readScopeSpend('product', productId);
}

/** Today's persisted global (fleet-wide) spend in cents. */
export async function getGlobalDailySpend(): Promise<number> {
  return readScopeSpend('global', GLOBAL_SCOPE_ID);
}

/**
 * True if any applicable cap (product, founder, or global) is exhausted for
 * today. Reads are cached and fail-open on DB errors.
 */
export async function isCostCeilingReached(productId?: string): Promise<boolean> {
  if (await readScopeSpend('global', GLOBAL_SCOPE_ID) >= GLOBAL_COST_CEILING_CENTS) return true;
  if (!productId) return false;
  if (await readScopeSpend('product', productId) >= DAILY_COST_CEILING_CENTS) return true;
  const founderId = await resolveFounderId(productId);
  if (founderId && (await readScopeSpend('founder', founderId)) >= FOUNDER_COST_CEILING_CENTS) return true;
  return false;
}

// ─── Timeout + Retry ─────────────────────────────────────────────────────────
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS ?? '120000', 10);
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

function getApiKey(): string {
  // Prefer OpenRouter; fall back to direct Anthropic for backward compatibility
  const key = process.env.OPENROUTER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) is required');
  return key;
}

function getBaseUrl(): string {
  // If using OpenRouter key, use OpenRouter endpoint
  // If using direct Anthropic key (fallback), still route through OpenRouter for consistency
  return process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

/**
 * Make an LLM call via OpenRouter with cost ceiling, timeout, and retry.
 */
export async function callClaude(config: AICallConfig & { productId?: string }): Promise<AIResponse> {
  if (await isCostCeilingReached(config.productId)) {
    throw new Error(`AI daily cost ceiling reached (product ${config.productId ?? 'n/a'})`);
  }

  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const startedAt = Date.now();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.APP_URL ?? 'https://foundry-intel.fly.dev',
          'X-Title': 'Foundry',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature ?? 0.3,
          messages: [
            { role: 'system', content: config.systemPrompt },
            { role: 'user', content: config.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(`OpenRouter API error ${response.status}: ${body}`);
        (err as unknown as Record<string, unknown>).status = response.status;
        throw err;
      }

      const data = (await response.json()) as OpenRouterResponse;
      const textContent = data.choices?.[0]?.message?.content ?? '';

      await recordSpend(
        config.productId,
        config.model,
        data.usage?.prompt_tokens ?? 0,
        data.usage?.completion_tokens ?? 0,
      );

      log.info('ai_call.complete', {
        model: config.model,
        productId: config.productId,
        attempt,
        durationMs: Date.now() - startedAt,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      });

      return {
        content: textContent,
        model: config.model,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
        },
        stop_reason: data.choices?.[0]?.finish_reason ?? null,
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));

      const status = (err as unknown as Record<string, unknown>)?.status as number | undefined;
      if (status && status < 500 && status !== 429) {
        log.error('ai_call.failed_non_retryable', lastError, {
          model: config.model,
          productId: config.productId,
          status,
        });
        reportError(lastError, { source: 'ai_client', productId: config.productId, meta: { status } });
        throw lastError;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        log.warn('ai_call.retry', {
          model: config.model,
          productId: config.productId,
          attempt,
          status,
          delayMs: Math.round(delay),
          error: lastError.message,
        });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  log.error('ai_call.exhausted', lastError, {
    model: config.model,
    productId: config.productId,
    attempts: MAX_RETRIES + 1,
  });
  reportError(lastError, { source: 'ai_client', productId: config.productId, meta: { attempts: MAX_RETRIES + 1 } });
  throw lastError ?? new Error('AI call failed after retries');
}

/**
 * Call with strategic model (Opus) for methodology execution.
 */
export async function callOpus(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8192,
  productId?: string,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.OPUS, maxTokens, systemPrompt, userPrompt, productId });
}

/**
 * Call with operational model (Sonnet) for fast intelligence.
 */
export async function callSonnet(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  productId?: string,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.SONNET, maxTokens, systemPrompt, userPrompt, productId });
}

/**
 * Call with the cheap classification model (Haiku) — scratchpad analysis,
 * relevance scoring, prompt-injection screening. Not for reasoning-heavy work.
 */
export async function callHaiku(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 1024,
  productId?: string,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.HAIKU, maxTokens, systemPrompt, userPrompt, productId });
}

/**
 * Multi-turn call with full message history.
 */
export async function callClaudeMultiTurn(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 1024,
  useOpus: boolean = false,
  productId?: string,
): Promise<AIResponse> {
  if (await isCostCeilingReached(productId)) {
    throw new Error(`AI daily cost ceiling reached for product ${productId ?? 'n/a'}`);
  }

  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = useOpus ? MODELS.OPUS : MODELS.SONNET;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.APP_URL ?? 'https://foundry-intel.fly.dev',
          'X-Title': 'Foundry',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages,
          ],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const err = new Error(`OpenRouter API error ${response.status}: ${body}`);
        (err as unknown as Record<string, unknown>).status = response.status;
        throw err;
      }

      const data = (await response.json()) as OpenRouterResponse;
      const textContent = data.choices?.[0]?.message?.content ?? '';

      await recordSpend(productId, model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);

      return {
        content: textContent,
        model,
        usage: {
          input_tokens: data.usage?.prompt_tokens ?? 0,
          output_tokens: data.usage?.completion_tokens ?? 0,
        },
        stop_reason: data.choices?.[0]?.finish_reason ?? null,
      };
    } catch (err) {
      clearTimeout(timeout);
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as unknown as Record<string, unknown>)?.status as number | undefined;
      if (status && status < 500 && status !== 429) throw lastError;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('AI multi-turn call failed after retries');
}

/**
 * Parse a JSON response, handling markdown code fences.
 * Optional Zod schema for runtime validation.
 */
export function parseJSONResponse<T>(content: string, schema?: z.ZodType<T>): T {
  let cleaned = content.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try {
    const parsed = JSON.parse(cleaned) as T;
    if (schema) {
      const result = schema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`AI response schema validation failed: ${result.error.message}`);
      }
      return result.data;
    }
    return parsed;
  } catch (err) {
    const preview = cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned;
    throw new Error(`Failed to parse AI JSON response: ${(err as Error).message}. Preview: ${preview}`);
  }
}
