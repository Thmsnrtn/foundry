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
import {
  DAILY_COST_CEILING_CENTS, FOUNDER_COST_CEILING_CENTS, GLOBAL_COST_CEILING_CENTS,
} from '../deployment/ai-ceilings.js';
import { finishReservation, reserveSpend, type SpendReservation } from './spend-ledger.js';
import {
  refuseIfItChangesNothing, subjectPurpose, subjectWork,
  type SpendPurpose, type SpendSubject, type Work,
} from './what-it-is-for.js';

// RE-EXPORTED SO ONE IMPORT STILL REACHES BOTH. What a call is FOR is declared
// in `what-it-is-for.ts` rather than here, because eighteen test files replace
// this module wholesale with a stub of `callSonnet` — and a call site that
// imported its own declaration helper from a mocked module got `undefined` and
// threw inside the thing under test. Declaring a subject is not making a call.
export {
  institutionSpend, companySpend, subjectPurpose, subjectWork,
  type SpendPurpose, type SpendPurposeKind, type SpendSubject,
  type InstitutionSpend, type CompanySpend, type Work,
} from './what-it-is-for.js';

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
// The three caps themselves live in `deployment/ai-ceilings.ts`, not here:
// they bound this deployment rather than belonging to the thing that spends,
// and the institutional kernel must be able to read them without importing a
// model client. This module enforces them; it does not own them.
export {
  DAILY_COST_CEILING_CENTS, FOUNDER_COST_CEILING_CENTS, GLOBAL_COST_CEILING_CENTS, AI_CEILINGS,
} from '../deployment/ai-ceilings.js';

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

/**
 * The owner of the product that IS the institution, or null where none is established (R32).
 *
 * REALITY AND STANDING DO NOT APPLY: an identity lookup of the one product that is
 * Foundry, to find whose cap its thinking counts against; it reads no
 * company's truth, and a narrower answer could only lift the bound.
 */
async function institutionOwner(): Promise<string | null> {
  try {
    const r = await query(`SELECT p.owner_id FROM system_identities s JOIN products p ON p.id = s.product_id WHERE s.identity_key = 'foundry'`, []);
    return r.rows.length ? String((r.rows[0] as Record<string, unknown>).owner_id) : null;
  } catch (err) {
    log.warn('ai_spend.institution_owner_lookup_failed', { error: (err as Error).message });
    return null;
  }
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
// The provider's published rates (Anthropic's first-party prices, which
// OpenRouter passes through), read 2026-10-05 (R32). Opus was charged at three
// times and Sonnet at one and a half times its rate, so every bound bought less
// thinking than it said. Configurable via environment variables.
const COST_PER_1M: Record<string, { input: number; output: number }> = {
  'anthropic/claude-opus-4-8': {
    input: parseFloat(process.env.AI_COST_OPUS_INPUT_PER_1M ?? '5.00'),
    output: parseFloat(process.env.AI_COST_OPUS_OUTPUT_PER_1M ?? '25.00'),
  },
  'anthropic/claude-sonnet-5': {
    input: parseFloat(process.env.AI_COST_SONNET_INPUT_PER_1M ?? '2.00'),
    output: parseFloat(process.env.AI_COST_SONNET_OUTPUT_PER_1M ?? '10.00'),
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
  const rates = COST_PER_1M[model] ?? COST_PER_1M['anthropic/claude-sonnet-5']; // An unknown model is priced as Sonnet
  const inputCostCents = (inputTokens * rates.input) / 10_000;
  const outputCostCents = (outputTokens * rates.output) / 10_000;
  return inputCostCents + outputCostCents;
}

function subjectProductId(subject: SpendSubject | undefined): string | undefined {
  return subject && 'productId' in subject ? subject.productId : undefined;
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
/**
 * THE MODEL DOOR FAILED (Roadmap 2027 R33): the provider refused (no credits,
 * a revoked key), did not answer, or answered with no completion. Named so a
 * caller can tell it from a refusal of its own and let it through, and so a
 * routine's recorded failure says "ModelDoorError" rather than "Error".
 */
export class ModelDoorError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ModelDoorError';
    this.status = status;
  }
}

/**
 * THE DOOR IS DOWN, AND NOT ASKED AGAIN YET (remediation 1.4). A typed refusal
 * made before any money is reserved or any request sent: a hung or failing
 * door used to be waited on three times per call, by every call, so one bad
 * morning could hold the forge for tens of minutes. A `ModelDoorError`, so
 * every caller that lets the door's failure through lets this through too.
 */
export class ModelDoorClosed extends ModelDoorError {
  readonly until: Date;
  constructor(failures: number, until: Date) {
    super(`the model door failed ${String(failures)} times in a row; not asked again until ${until.toISOString().slice(11, 16)} UTC`, 503);
    this.name = 'ModelDoorClosed';
    this.until = until;
  }
}

// ─── The door breaker (remediation 1.4) ────────────────────────────────────
//
// After DOOR_TRIPS_AFTER consecutive failed attempts at the door, each within
// DOOR_WINDOW_MS of the last, no call is made for DOOR_COOLDOWN_MS. When the
// cooldown ends ONE call is let through as a probe: an answer closes the
// breaker, a failure opens it again at once. In memory, on purpose: this is
// one process's view of a door it shares with nobody, and a restart is a new
// view that should ask. `productionFacts` reads it through `modelDoorBreaker`.
export const DOOR_TRIPS_AFTER = 3;
const DOOR_WINDOW_MS = 10 * 60_000;
export const DOOR_COOLDOWN_MS = 10 * 60_000;
const door = { consecutive: 0, lastFailureAt: 0, openUntil: 0, probing: false, probeStartedAt: 0 };
/** How long one probe may hold the door before another call may try (two of the longest attempts). */
const PROBE_HOLD_MS = 4 * 60_000;

/**
 * WHETHER A FAILURE IS THE DOOR'S (remediation audit, 6 October 2026). A 400
 * for one request — a prompt too long, a malformed body — is that request's
 * fault, and counting three of them as "the door is down" shut every caller
 * out for ten minutes and told the owner to check the credit and the key. The
 * door is down when it does not answer (no status: a timeout, the network, an
 * empty completion), errs (5xx), is rate limiting (429), or refuses the key or
 * the credit (401, 402).
 */
function isTheDoors(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 429 || status === 408 || status === 401 || status === 402;
}

/** What the breaker says now: closed, or open until a moment, after how many failures. */
export function modelDoorBreaker(now = Date.now()): { open: boolean; until: Date | null; consecutiveFailures: number } {
  return { open: door.openUntil > now, until: door.openUntil > now ? new Date(door.openUntil) : null, consecutiveFailures: door.consecutive };
}

/** Test seam: a later morning, after the cooldown. Never called by the application. */
export function forgetModelDoorFailures(): void {
  door.consecutive = 0; door.lastFailureAt = 0; door.openUntil = 0; door.probing = false; door.probeStartedAt = 0;
}

/** Refuses a call while the door is known to be down. True when this call is
 *  the probe, which the caller must hand back if it fails before the door. */
function refuseIfDoorClosed(now = Date.now()): boolean {
  if (door.openUntil > now) throw new ModelDoorClosed(door.consecutive, new Date(door.openUntil));
  // ONE PROBE, NOT EVERY CALLER IN THE SAME INSTANT: while the probe is out,
  // the door stays closed to everyone else (until it answers, fails, or has
  // held longer than any attempt could take).
  if (door.probing && now - door.probeStartedAt < PROBE_HOLD_MS) {
    throw new ModelDoorClosed(door.consecutive, new Date(door.probeStartedAt + PROBE_HOLD_MS));
  }
  // The cooldown is over: this call is the probe, and the next failure reopens.
  if (door.openUntil !== 0 || door.probing) { door.probing = true; door.probeStartedAt = now; door.openUntil = 0; return true; }
  return false;
}

/**
 * A PROBE THAT NEVER REACHED THE DOOR TESTED NOTHING (second remediation
 * audit). The key, the owner and the spend cap are read after the probe is
 * claimed; a refusal there used to leave the door held for four minutes, every
 * caller told the door was down although nobody had asked it. The next call is
 * the probe instead.
 */
function handBackProbe(): void {
  if (door.probing) door.probeStartedAt = 0;
}

/** Whatever happens before the door is asked, a claimed probe is handed back if it throws. */
async function beforeTheDoor<T>(probe: boolean, work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (err) { if (probe) handBackProbe(); throw err; }
}

function doorAnswered(): void {
  door.consecutive = 0; door.lastFailureAt = 0; door.openUntil = 0; door.probing = false; door.probeStartedAt = 0;
}

/**
 * The door refused one request as that request's fault: it is up. But a
 * refusal of a call sent before the breaker opened says nothing about the
 * failures that opened it since, so an open breaker stays open (second audit).
 * A probe's refusal does close it: a probe is sent with the breaker shut.
 */
function doorRefusedTheRequest(now = Date.now()): void {
  if (door.openUntil > now) return;
  doorAnswered();
}

/**
 * What one failed attempt tells the breaker: the door's failure counts, the
 * request's refusal does not. Both call paths use this; it is exported so the
 * breaker's arithmetic is tested through the function the calls use. True
 * when the breaker is now open.
 */
export function doorHeard(status: number | undefined, now = Date.now()): boolean {
  if (isTheDoors(status)) return doorFailed(now);
  doorRefusedTheRequest(now);
  return false;
}

/** One failed attempt at the door. True when the breaker is now open. */
function doorFailed(now = Date.now()): boolean {
  door.consecutive = now - door.lastFailureAt <= DOOR_WINDOW_MS ? door.consecutive + 1 : 1;
  door.lastFailureAt = now;
  if (door.probing || door.consecutive >= DOOR_TRIPS_AFTER) {
    door.openUntil = now + DOOR_COOLDOWN_MS;
    door.probing = false;
    return true;
  }
  return false;
}

/**
 * HOW LONG ONE ATTEMPT MAY WAIT, BY TIER (remediation 1.4). One 120 s wait for
 * every model meant a hung door cost a Haiku call as much as an Opus one. A
 * deployment's AI_TIMEOUT_MS still overrides every tier.
 */
export function attemptTimeoutMs(model: string, env: NodeJS.ProcessEnv = process.env): number {
  const set = Number.parseInt(env.AI_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(set) && set > 0) return set;
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 30_000;
  if (m.includes('sonnet')) return 75_000;
  return 120_000;
}

/**
 * HOW LONG ONE WHOLE CALL MAY TAKE, BY TIER — every attempt and every backoff
 * together (Stage 1 F1.4, kept when the two model-door fixes were reconciled).
 * The per-attempt wait alone still let three Opus attempts hold one call for
 * six minutes before the breaker had heard enough to open. No attempt starts,
 * and no backoff waits, past the call's deadline; the last attempt's wait is
 * cut to what is left. A deployment's AI_CALL_BUDGET_MS overrides every tier.
 */
export function callBudgetMs(model: string, env: NodeJS.ProcessEnv = process.env): number {
  const set = Number.parseInt(env.AI_CALL_BUDGET_MS ?? '', 10);
  if (Number.isFinite(set) && set > 0) return set;
  const m = model.toLowerCase();
  if (m.includes('haiku')) return 60_000;
  if (m.includes('sonnet')) return 150_000;
  return 180_000;
}

/** A 200 that carries an error, or no completion, is a failure and not an empty answer. */
function noCompletion(data: OpenRouterResponse): ModelDoorError | null {
  const e = (data as unknown as { error?: { message?: string; code?: number } }).error;
  if (e || !Array.isArray(data.choices) || data.choices.length === 0) {
    // An error the body names as the request's own (a 4xx other than a timeout
    // or a rate limit: a prompt too long) keeps its code, so it is neither
    // retried nor counted against the door; anything else is the door's.
    const code = typeof e?.code === 'number' ? e.code : null;
    const theRequests = code !== null && code >= 400 && code < 500 && code !== 408 && code !== 429;
    return new ModelDoorError(`OpenRouter answered with no completion${e?.message ? `: ${e.message}` : ''}`, theRequests || (code !== null && code >= 500) ? code : 502);
  }
  return null;
}
/** Whatever stopped the last attempt, named as the door's failure. */
function asDoorError(err: Error | null, fallback: string): ModelDoorError {
  if (err instanceof ModelDoorError) return err;
  return new ModelDoorError(err?.message ?? fallback, null);
}

export async function companyMayIncurCost(productId: string): Promise<string | null> {
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
              erasure_scheduled_at AS erasing,
              reality,
              standing,
              CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS operating
         FROM products WHERE id = ?`, [productId]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    // A TEST OBJECT HAS NO COMPANY SPEND. Its experiment spends through the
    // workshop budget and the founder scope; charging a model call to the
    // asset itself is the accounting that lets a test look like a business.
    // Said here, ahead of the ladder, so the reason is this and not the
    // 'provisioning' the ladder would otherwise fall through to.
    if (String(row.standing) === 'experimental') {
      return 'an experimental asset — its test spends through its experiment, not as company cost';
    }
    // A REHEARSAL MAY NOT SPEND THE REAL COMPANIES' MONEY.
    //
    // The founder and global ceilings are shared pools — $100 and $500 a day
    // across everything — reserved before dispatch and enforced by migration
    // 099's triggers. A reference company exercising a loop could exhaust them
    // and make genuine work fail with SpendCeilingError, which is the one
    // failure mode where a fake company damages a real one without touching it.
    //
    // Refused outright rather than given its own pool, because nothing the
    // reference world exists to exercise yet costs anything: observation,
    // responsibility, shadowing, comparison, metrics and portfolio reasoning
    // are all deterministic, exactly as the Foundry-on-Foundry loop is — it has
    // spent $0 while proving the entire ladder. When a scenario genuinely needs
    // a model, it gets a separate ceiling of its own, decided then and sized to
    // what it is for. Refusing now costs nothing and cannot starve anyone.
    if (String(row.reality) === 'reference') return 'a reference company';
    // AND WHAT THE OWNER SAID. "Do not spend anything" is an instruction, not a
    // setting, so it is checked ahead of the ladder below — a company that is
    // otherwise perfectly entitled to spend still may not when he has said so.
    // The reason is his own sentence, because this string becomes the message
    // on a NotEntitledError he will eventually read.
    const intent = await import('../institution/standing-intent.js');
    const allowance = await intent.allowanceFor(productId);
    const said = await intent.boundaryStandingInTheWay({ productId, door: 'spend' });
    if (said) {
      // AN ALLOWANCE CARVES AN EXCEPTION TO A SPEND BOUNDARY, which is what
      // "don't spend anything — except up to $25 testing this" means when a
      // person says it. Exhausted, the boundary is simply back.
      if (!allowance || allowance.remainingCents <= 0) {
        return `something you said — "${said.statement}"`;
      }
    }
    // AND IT IS A CEILING EVEN WHEN NOTHING IS FORBIDDEN. He set a number; the
    // number is the answer, and the message says what is left rather than
    // making him work it out.
    if (allowance && allowance.remainingCents <= 0) {
      return `the $${(allowance.amountCents / 100).toFixed(2)} you allowed is spent`;
    }
    if (Number(row.operating) === 1) return null;
    if (String(row.s) !== 'active') return `archived (${String(row.s)})`;
    if (row.erasing != null) return 'scheduled for deletion';
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
  purpose: SpendPurpose | null = null,
  work: Work | null = null,
): Promise<SpendReservation> {
  // THE INSTITUTION'S THINKING IS ITS OWNER'S (R32). A call made for the
  // owner's portfolio before any company exists names no product, and the cap
  // was resolved only from a product: the forge, offer composition, discovery,
  // the legal pass and correspondence ran to the deployment's global ceiling,
  // and none of it reached the ledger the owner reads.
  const founderId = productId ? await resolveFounderId(productId) : await institutionOwner();
  if (productId && !founderId) {
    throw new Error(`AI spend authorization failed: owner unavailable for product ${productId}`);
  }
  // A token cannot encode less than one UTF-8 byte. Byte length plus a small
  // message-framing allowance is therefore a conservative input-token bound;
  // maxOutputTokens is the provider-enforced output bound.
  const maxInputTokens = new TextEncoder().encode(prompt).length + 64;
  const amountCents = Math.max(computeCostCents(model, maxInputTokens, maxOutputTokens), 0.000001);
  // THE THINKING BOUND THE OWNER READS IS THE ONE THAT REFUSES THE CALL. The
  // charter's daily rate (or the pre-charter bound) used to stop one job from
  // starting a pass; every other call ran to the deployment's founder cap.
  // The founder-scope cap handed to the guard is now the lower of the two, so
  // "I stop thinking at $1 a day until you sign" is enforced where thinking
  // is bought, and the reservation row records the cap that applied.
  let founderCap = FOUNDER_COST_CEILING_CENTS;
  if (founderId) {
    const { thinkingCapFor } = await import('../institution/spending.js');
    founderCap = Math.min(founderCap, await thinkingCapFor(founderId));
  }
  return reserveSpend({
    productId, founderId: founderId ?? undefined, model, amountCents,
    caps: { global: GLOBAL_COST_CEILING_CENTS, product: DAILY_COST_CEILING_CENTS, founder: founderCap },
    purpose, work,
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
// Each attempt's wait is `attemptTimeoutMs(model)`, read per call.
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
// The delimiters are NUL, escaped rather than written as raw bytes: a raw
// NUL in the first 8000 bytes of a file makes git call the whole file binary
// and print "Binary files differ" instead of a diff, and makes grep skip it.
export const CACHE_BREAKPOINT = '\u0000__FOUNDRY_CACHE_BREAKPOINT__\u0000';

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

// ─── The deploy marker never leaves the door ────────────────────────────────
//
// A commit whose message carries the private deploy marker deploys production
// (.github/workflows/deploy-private.yml, matched without regard to case). The
// marker is a word, and a model can write any word. So nothing a model says
// may carry it anywhere Foundry writes — a reading, a design, a page, a file,
// a message — and the one place every model reply passes is here. A reply
// that carries it is REFUSED, not repaired: it was answered and is paid for,
// and then it is not used, with a reason that says where in the reply the
// marker sat (the marker itself shown as a placeholder, never written out).
// Assembled at run time so this file does not carry it either.

const DEPLOY_MARKER = ['[deploy', '-private]'].join('');

/** A model's reply that was answered and refused, with why. Not a door failure: the door is up. */
export class ModelReplyRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelReplyRefused';
  }
}

/** Throws ModelReplyRefused when the reply carries the deploy marker; otherwise returns nothing. */
export function refuseAMarkedReply(content: string): void {
  const at = content.toLowerCase().indexOf(DEPLOY_MARKER);
  if (at < 0) return;
  const anyCase = new RegExp(DEPLOY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const around = content.slice(Math.max(0, at - 60), at + DEPLOY_MARKER.length + 60)
    .replace(anyCase, '⟨the deploy marker⟩').replace(/\s+/g, ' ').trim();
  throw new ModelReplyRefused(`the model's reply carried the marker that deploys production, which nothing Foundry writes may carry; it was refused, not used: "…${around}…"`);
}

/**
 * Make an LLM call via OpenRouter with cost ceiling, timeout, and retry.
 * The reply is refused at the door when it carries the deploy marker.
 */
export async function callClaude(
  config: AICallConfig & { subject: SpendSubject },
): Promise<AIResponse> {
  const reply = await callClaudeAtTheDoor(config);
  refuseAMarkedReply(reply.content);
  return reply;
}

async function callClaudeAtTheDoor(
  config: AICallConfig & { subject: SpendSubject },
): Promise<AIResponse> {
  const productId = subjectProductId(config.subject);
  // BEFORE the key and before the reservation. Refusing to spend must not
  // depend on whether a provider is configured, and a reservation taken and
  // then abandoned by a later throw sits as 'reserved' until it expires at the
  // full authorized amount.
  await refuseIfNotEntitled(productId);
  refuseIfItChangesNothing(subjectWork(config.subject));
  // A DOOR KNOWN TO BE DOWN IS NOT ASKED, and nothing is reserved for it.
  const probe = refuseIfDoorClosed();
  const { apiKey, reservation } = await beforeTheDoor(probe, async () => ({
    apiKey: getApiKey(),
    reservation: await authorizeSpend(
      productId, config.model, `${config.systemPrompt}\n${config.userPrompt}`, config.maxTokens,
      subjectPurpose(config.subject), subjectWork(config.subject),
    ),
  }));
  const baseUrl = getBaseUrl();
  const startedAt = Date.now();
  let lastError: Error | null = null;
  const waitMs = attemptTimeoutMs(config.model);
  const budgetMs = callBudgetMs(config.model);
  const deadline = startedAt + budgetMs;
  let attempts = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    attempts += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(waitMs, remaining));

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
        throw new ModelDoorError(`OpenRouter API error ${response.status}: ${body}`, response.status);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const empty = noCompletion(data);
      if (empty) throw empty;
      const textContent = data.choices?.[0]?.message?.content ?? '';
      doorAnswered();

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
      // The door answered this request with a refusal of it: the door is up.
      const tripped = doorHeard(status);
      if (status && status < 500 && status !== 429 && status !== 408) {
        await finishReservation(reservation, { kind: 'released' });
        log.error('ai_call.failed_non_retryable', lastError, {
          model: config.model,
          productId,
          status,
        });
        reportError(lastError, { source: 'ai_client', productId, meta: { status } });
        throw asDoorError(lastError, 'the model door refused');
      }
      // THE BREAKER OPENED ON THIS ATTEMPT: no more waiting on this call either.
      if (tripped) break;

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        // No backoff past the call's deadline: waiting to give up is still waiting.
        if (Date.now() + delay >= deadline) break;
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
    attempts,
    budgetMs,
  });
  await finishReservation(reservation, { kind: 'ambiguous' });
  reportError(lastError, { source: 'ai_client', productId: config.productId, meta: { attempts } });
  throw asDoorError(lastError, `AI call failed after ${String(attempts)} attempt${attempts === 1 ? '' : 's'} within ${String(budgetMs)} ms`);
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
  const reply = await callClaudeMultiTurnAtTheDoor(systemPrompt, messages, maxTokens, useOpus, productId);
  refuseAMarkedReply(reply.content);
  return reply;
}

async function callClaudeMultiTurnAtTheDoor(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  useOpus: boolean,
  productId?: string,
): Promise<AIResponse> {
  await refuseIfNotEntitled(productId);
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  const model = useOpus ? MODELS.OPUS : MODELS.SONNET;
  const probe = refuseIfDoorClosed();
  const reservation = await beforeTheDoor(probe, () => authorizeSpend(
    productId, model, [systemPrompt, ...messages.map((m) => `${m.role}:${m.content}`)].join('\n'), maxTokens,
  ));
  let lastError: Error | null = null;
  const deadline = Date.now() + callBudgetMs(model);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(attemptTimeoutMs(model), remaining));

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
        throw new ModelDoorError(`OpenRouter API error ${response.status}: ${body}`, response.status);
      }

      const data = (await response.json()) as OpenRouterResponse;
      const empty = noCompletion(data);
      if (empty) throw empty;
      const textContent = data.choices?.[0]?.message?.content ?? '';
      doorAnswered();

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
      const tripped = doorHeard(status);
      if (status && status < 500 && status !== 429 && status !== 408) {
        await finishReservation(reservation, { kind: 'released' });
        throw asDoorError(lastError, 'the model door refused');
      }
      if (tripped) break;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        if (Date.now() + delay >= deadline) break;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  await finishReservation(reservation, { kind: 'ambiguous' });
  throw asDoorError(lastError, 'AI multi-turn call failed after retries');
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
