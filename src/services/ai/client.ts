// =============================================================================
// FOUNDRY — Anthropic AI Client
// Wraps the Anthropic SDK for all Claude API calls.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { AIModel, AICallConfig, AIResponse } from '../../types/ai.js';

let _client: Anthropic | null = null;

export const MODELS = {
  OPUS: 'claude-opus-4-6' as AIModel,
  SONNET: 'claude-sonnet-4-5-20250929' as AIModel,
} as const;

// ─── Cost Ceiling ────────────────────────────────────────────────────────────
// Per-product daily AI spend cap. Prevents unbounded Anthropic bills.
// Default $25/day per product. Configurable via AI_DAILY_COST_CEILING_CENTS env var.
const DAILY_COST_CEILING_CENTS = parseInt(process.env.AI_DAILY_COST_CEILING_CENTS ?? '2500', 10);
const dailySpend = new Map<string, { cents: number; date: string }>();

function recordSpend(productId: string | undefined, inputTokens: number, outputTokens: number): void {
  if (!productId) return;
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailySpend.get(productId);
  // Opus: $15/M input, $75/M output; Sonnet: $3/M input, $15/M output
  // Use Opus rates as conservative upper bound
  const costCents = (inputTokens * 0.0015 + outputTokens * 0.0075);
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
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS ?? '120000', 10); // 2 min default
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 1000;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required');
    _client = new Anthropic({ apiKey, timeout: AI_TIMEOUT_MS });
  }
  return _client;
}

/**
 * Make a Claude API call with cost ceiling, timeout, and retry.
 * Pass config.productId to enforce per-product daily cost limit.
 */
export async function callClaude(config: AICallConfig & { productId?: string }): Promise<AIResponse> {
  // Check cost ceiling before calling
  if (config.productId && isCostCeilingReached(config.productId)) {
    throw new Error(`AI daily cost ceiling reached for product ${config.productId} ($${(DAILY_COST_CEILING_CENTS / 100).toFixed(2)})`);
  }

  const client = getClient();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature ?? 0.3,
        system: config.systemPrompt,
        messages: [{ role: 'user', content: config.userPrompt }],
      });

      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      // Track cost
      recordSpend(config.productId, response.usage.input_tokens, response.usage.output_tokens);

      return {
        content: textContent,
        model: config.model,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
        stop_reason: response.stop_reason,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Don't retry on non-retryable errors (auth, invalid request)
      const status = (err as any)?.status;
      if (status && status < 500 && status !== 429) throw lastError;

      // Jittered exponential backoff
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error('AI call failed after retries');
}

/**
 * Call Claude Opus for strategic/methodology execution.
 * Pass productId to enforce per-product cost ceiling.
 */
export async function callOpus(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8192,
  productId?: string,
): Promise<AIResponse> {
  return callClaude({
    model: MODELS.OPUS,
    maxTokens,
    systemPrompt,
    userPrompt,
    productId,
  });
}

/**
 * Call Claude Sonnet for operational intelligence.
 * Pass productId to enforce per-product cost ceiling.
 */
export async function callSonnet(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  productId?: string,
): Promise<AIResponse> {
  return callClaude({
    model: MODELS.SONNET,
    maxTokens,
    systemPrompt,
    userPrompt,
    productId,
  });
}

/**
 * Multi-turn Claude call with a full message history array.
 * Used by the conversational layer to maintain context across turns.
 */
export async function callClaudeMultiTurn(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number = 1024,
  useOpus: boolean = false,
): Promise<AIResponse> {
  const client = getClient();
  const model = useOpus ? MODELS.OPUS : MODELS.SONNET;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.3,
    system: systemPrompt,
    messages,
  });

  const textContent = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return {
    content: textContent,
    model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    stop_reason: response.stop_reason,
  };
}

/**
 * Parse a JSON response from Claude, handling markdown code fences.
 * Throws a descriptive error instead of crashing on malformed JSON
 * (e.g., truncated output from max_tokens limit).
 */
export function parseJSONResponse<T>(content: string): T {
  let cleaned = content.trim();
  // Remove markdown code fences if present
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    // Provide context for debugging — truncated AI output is a common cause
    const preview = cleaned.length > 200 ? cleaned.slice(0, 200) + '...' : cleaned;
    throw new Error(`Failed to parse AI JSON response: ${(err as Error).message}. Preview: ${preview}`);
  }
}
