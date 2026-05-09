// =============================================================================
// FOUNDRY — AI Client (OpenRouter)
// Routes all LLM calls through OpenRouter for cost efficiency and model flexibility.
// Supports Claude, GPT, and any OpenRouter-available model via config.
// =============================================================================

import { z } from 'zod';
import type { AIModel, AICallConfig, AIResponse } from '../../types/ai.js';
import { log } from '../../lib/logger.js';
import { reportError } from '../../lib/error-reporter.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const MODELS = {
  // Strategic / methodology — highest quality, used for audit scoring, weekly synthesis
  OPUS: 'anthropic/claude-opus-4-6' as AIModel,
  // Operational / fast — used for agent runs, briefings, competitive scans
  SONNET: 'anthropic/claude-sonnet-4-5-20250929' as AIModel,
} as const;

// ─── Cost Ceiling ────────────────────────────────────────────────────────────
// Per-product daily AI spend cap. Prevents unbounded bills.
// Default $25/day per product. Configurable via AI_DAILY_COST_CEILING_CENTS env var.
const DAILY_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10);
const dailySpend = new Map<string, { cents: number; date: string }>();

// ─── Model-Specific Pricing (per 1M tokens, in USD) ─────────────────────────
// OpenRouter pricing. Configurable via environment variables.
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'anthropic/claude-opus-4-6': {
    input: parseFloat(process.env.AI_COST_OPUS_INPUT_PER_1M ?? '15.00'),
    output: parseFloat(process.env.AI_COST_OPUS_OUTPUT_PER_1M ?? '75.00'),
  },
  'anthropic/claude-sonnet-4-5-20250929': {
    input: parseFloat(process.env.AI_COST_SONNET_INPUT_PER_1M ?? '3.00'),
    output: parseFloat(process.env.AI_COST_SONNET_OUTPUT_PER_1M ?? '15.00'),
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

function recordSpend(productId: string | undefined, model: AIModel | string, inputTokens: number, outputTokens: number): void {
  if (!productId) return;
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailySpend.get(productId);
  const costCents = computeCostCents(model, inputTokens, outputTokens);
  if (!entry || entry.date !== today) {
    dailySpend.set(productId, { cents: costCents, date: today });
  } else {
    entry.cents += costCents;
  }
}

export function getDailySpend(productId: string): number {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailySpend.get(productId);
  if (!entry || entry.date !== today) return 0;
  return entry.cents;
}

export function isCostCeilingReached(productId: string): boolean {
  return getDailySpend(productId) >= DAILY_COST_CEILING_CENTS;
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
  if (config.productId && isCostCeilingReached(config.productId)) {
    throw new Error(`AI daily cost ceiling reached for product ${config.productId} ($${(DAILY_COST_CEILING_CENTS / 100).toFixed(2)})`);
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

      recordSpend(
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
 * Multi-turn call with full message history.
 */
export async function callClaudeMultiTurn(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 1024,
  useOpus: boolean = false,
  productId?: string,
): Promise<AIResponse> {
  if (productId && isCostCeilingReached(productId)) {
    throw new Error(`AI daily cost ceiling reached for product ${productId}`);
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

      recordSpend(productId, model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);

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
