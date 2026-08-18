// =============================================================================
// FOUNDRY — AI Client (OpenRouter)
// Routes all LLM calls through OpenRouter for cost efficiency and model flexibility.
// Supports Claude, GPT, and any OpenRouter-available model via config.
// =============================================================================

import { z } from 'zod';
import type { AIModel, AICallConfig, AIResponse } from '../../types/ai.js';
import { log } from '../../lib/logger.js';
import { reportError } from '../../lib/error-reporter.js';
import { operatingProduct, query } from '../../db/client.js';
import { finishReservation, reserveSpend, type SpendReservation } from './spend-ledger.js';

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

/**
 * WHO IS THIS CALL FOR?
 *
 * A model call is either work for one company or work for the institution
 * itself. There is no third case, and there is no "we did not say".
 *
 * `productId` used to be the fourth, optional argument, so omitting it meant
 * BOTH "this is institutional" and "somebody forgot" — fifty-five of a hundred
 * and four call sites had forgotten, and the resulting spend was bounded only
 * by the global ceiling. Omission cannot be allowed to carry meaning when the
 * two meanings differ by an unbounded amount of money.
 *
 * The subject is now required at the type boundary, and institutional calls say
 * so out loud with a reason a reader can check.
 */
export interface InstitutionSpend {
  readonly institutionReason: string;
}

/** Declare a model call as the institution's own, with the reason it has no
 * company to charge. The reason is not decoration: it is what a reviewer reads
 * to decide whether this really is institutional or just unattributed. */
export function institutionSpend(reason: string): InstitutionSpend {
  return { institutionReason: reason };
}

/** A company id, or an explicit institutional declaration. Never undefined. */
export type SpendSubject = string | InstitutionSpend;

function subjectProductId(subject: SpendSubject): string | undefined {
  return typeof subject === 'string' ? subject : undefined;
}

/** Refuse before anything is reserved or dispatched. */
async function refuseIfNotEntitled(productId: string | undefined): Promise<void> {
  if (!productId) return;
  const notActing = await companyMayIncurCost(productId);
  if (notActing) throw new NotEntitledError(productId, notActing);
}

/** Raised when the company is not entitled to have money spent on it. Named,
 * so a caller can tell "we are not doing this" from "the provider failed". */
export class NotEntitledError extends Error {
  constructor(productId: string, state: string) {
    super(`AI spend refused: company ${productId} is ${state}`);
    this.name = 'NotEntitledError';
  }
}

/**
 * Is this company one Foundry is currently operating?
 *
 * The owner's decision is that an unpaid account is read-only: no spend, no
 * outward effects. The outbound gateway enforces the second half and the job
 * work-lists enforce most of the first, but an interactive dashboard request
 * reaches a model directly — so the rule is checked here too, at the one place
 * every model call passes through.
 *
 * An UNKNOWN product does not refuse. This is an entitlement check, not an
 * authorization check: refusing an id that names no company would turn a
 * missing row into a silent outage, and `authorizeSpend` already fails on one
 * whose owner cannot be resolved.
 */
async function companyMayIncurCost(productId: string): Promise<string | null> {
  try {
    // THE DECISION COMES FROM THE CANONICAL PREDICATE; the columns are read
    // only to say WHY. This used to test status and scp_status directly, which
    // was complete until migration 145 gave commercial entitlement its own
    // field — and then the one check enforcing "an unpaid account spends
    // nothing" stopped seeing a cancelled subscription. A hand-copied fragment
    // of a rule goes stale the moment the rule grows another axis.
    const res = await query(
      `SELECT COALESCE(status,'active') AS s,
              COALESCE(scp_status,'active') AS scp,
              entitlement_paused_at AS billing_paused,
              CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS operating
         FROM products WHERE id = ?`, [productId]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    if (Number(row.operating) === 1) return null;
    if (String(row.s) !== 'active') return `archived (${String(row.s)})`;
    if (row.billing_paused != null) return 'unentitled';
    return String(row.scp);
  } catch (err) {
    // A ceiling that fails open on a DB error is the existing posture in this
    // file, and an entitlement check is not a safety boundary — the gateway is.
    log.warn('ai_spend.entitlement_lookup_failed', { productId, error: (err as Error).message });
    return null;
  }
}

async function authorizeSpend(
  productId: string | undefined,
  model: AIModel | string,
  prompt: string,
  maxOutputTokens: number,
): Promise<SpendReservation> {
  const founderId = productId ? await resolveFounderId(productId) : null;
  if (productId && !founderId) {
    throw new Error(`AI spend authorization failed: owner unavailable for product ${productId}`);
  }
  // A token cannot encode less than one UTF-8 byte. Byte length plus a small
  // message-framing allowance is therefore a conservative input-token bound;
  // maxOutputTokens is the provider-enforced output bound.
  const maxInputTokens = new TextEncoder().encode(prompt).length + 64;
  const amountCents = Math.max(computeCostCents(model, maxInputTokens, maxOutputTokens), 0.000001);
  return reserveSpend({
    productId, founderId: founderId ?? undefined, model, amountCents,
    caps: { global: GLOBAL_COST_CEILING_CENTS, product: DAILY_COST_CEILING_CENTS, founder: FOUNDER_COST_CEILING_CENTS },
  });
}

async function settleSpend(reservation: SpendReservation, actualCents: number): Promise<void> {
  await finishReservation(reservation, { kind: 'settled', actualCents });
  spendCache.clear();
}

/** Today's persisted product-level spend in cents. */
export async function getDailySpend(productId: string): Promise<number> {
  return readScopeSpend('product', productId);
}

/** Today's persisted global (fleet-wide) spend in cents. */
export async function getGlobalDailySpend(): Promise<number> {
  return readScopeSpend('global', GLOBAL_SCOPE_ID);
}

/** Global daily spend vs the global cap, for SLO/ops monitoring (Phase 3.3). */
export async function getGlobalSpendStatus(): Promise<{
  spentCents: number;
  capCents: number;
  pctOfCap: number;
}> {
  const spentCents = await readScopeSpend('global', GLOBAL_SCOPE_ID);
  const capCents = GLOBAL_COST_CEILING_CENTS;
  return { spentCents, capCents, pctOfCap: capCents > 0 ? spentCents / capCents : 0 };
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

// ─── Prompt caching (Phase 2.2) ─────────────────────────────────────────────
// Callers assemble system prompts stable-first and insert this sentinel between
// the stable prefix (persona, constitution, golden lessons, output standard —
// identical across an agent's runs) and the volatile suffix (integration
// events, messages, scratchpad, date). The client marks everything up to the
// sentinel with Anthropic prompt caching (cache_control: ephemeral), which
// OpenRouter passes through — a 60–90% input-cost cut on repeated agent runs.
export const CACHE_BREAKPOINT = ' __FOUNDRY_CACHE_BREAKPOINT__ ';

/**
 * Build the system message content. When the prompt contains a cache
 * breakpoint, emit structured content blocks with cache_control on the stable
 * prefix; otherwise emit a plain string (unchanged behavior).
 */
function buildSystemMessageContent(
  systemPrompt: string,
): string | Array<Record<string, unknown>> {
  const idx = systemPrompt.indexOf(CACHE_BREAKPOINT);
  if (idx === -1) return systemPrompt;

  const prefix = systemPrompt.slice(0, idx);
  const suffix = systemPrompt.slice(idx + CACHE_BREAKPOINT.length);
  const blocks: Array<Record<string, unknown>> = [
    { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
  ];
  if (suffix.trim().length > 0) {
    blocks.push({ type: 'text', text: suffix });
  }
  return blocks;
}

/**
 * Make an LLM call via OpenRouter with cost ceiling, timeout, and retry.
 */
export async function callClaude(
  config: AICallConfig & { subject: SpendSubject },
): Promise<AIResponse> {
  const productId = subjectProductId(config.subject);
  // BEFORE the key and before the reservation. Refusing to spend must not
  // depend on whether a provider is configured, and a reservation taken and
  // then abandoned by a later throw sits as 'reserved' until it expires at the
  // full authorized amount.
  await refuseIfNotEntitled(productId);
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const reservation = await authorizeSpend(
    productId, config.model, `${config.systemPrompt}\n${config.userPrompt}`, config.maxTokens,
  );
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
            { role: 'system', content: buildSystemMessageContent(config.systemPrompt) },
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

      await settleSpend(reservation, computeCostCents(
        config.model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0,
      )).catch((error) => {
        // The provider already responded: never retry an external effect merely
        // because local settlement failed. The reservation remains protective.
        log.error('ai_spend.settlement_failed', error as Error, { reservationId: reservation.id });
      });

      log.info('ai_call.complete', {
        model: config.model,
        productId,
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
        await finishReservation(reservation, { kind: 'released' });
        log.error('ai_call.failed_non_retryable', lastError, {
          model: config.model,
          productId,
          status,
        });
        reportError(lastError, { source: 'ai_client', productId, meta: { status } });
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
  await finishReservation(reservation, { kind: 'ambiguous' });
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
  subject: SpendSubject,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.OPUS, maxTokens, systemPrompt, userPrompt, subject });
}

/**
 * Call with operational model (Sonnet) for fast intelligence.
 */
export async function callSonnet(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096,
  subject: SpendSubject,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.SONNET, maxTokens, systemPrompt, userPrompt, subject });
}

/**
 * Call with the cheap classification model (Haiku) — scratchpad analysis,
 * relevance scoring, prompt-injection screening. Not for reasoning-heavy work.
 */
export async function callHaiku(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 1024,
  subject: SpendSubject,
): Promise<AIResponse> {
  return callClaude({ model: MODELS.HAIKU, maxTokens, systemPrompt, userPrompt, subject });
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
  await refuseIfNotEntitled(productId);
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = useOpus ? MODELS.OPUS : MODELS.SONNET;
  const reservation = await authorizeSpend(
    productId, model, [systemPrompt, ...messages.map((m) => `${m.role}:${m.content}`)].join('\n'), maxTokens,
  );
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
            { role: 'system', content: buildSystemMessageContent(systemPrompt) },
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

      await settleSpend(reservation, computeCostCents(
        model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0,
      )).catch((error) => {
        log.error('ai_spend.settlement_failed', error as Error, { reservationId: reservation.id });
      });

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
      if (status && status < 500 && status !== 429) {
        await finishReservation(reservation, { kind: 'released' });
        throw lastError;
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  await finishReservation(reservation, { kind: 'ambiguous' });
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
