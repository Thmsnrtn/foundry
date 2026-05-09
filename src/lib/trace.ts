// =============================================================================
// FOUNDRY — Trace Context
// AsyncLocalStorage-based trace propagation so a request's trace ID flows
// from middleware → route → service → AI client → DB without explicit
// threading. Charity Majors: 'you can't ship what you can't see.'
// =============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  /** Optional hierarchy: founder/product/agent attached at the entry point. */
  founderId?: string;
  productId?: string;
  agentName?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

// ─── Public API ───────────────────────────────────────────────────────────────

export function newTraceId(): string {
  return `tr_${randomBytes(8).toString('hex')}`;
}

/**
 * Run a callback inside a trace context. Anything async called during fn
 * sees the same context via currentTrace().
 */
export function withTrace<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Returns the current trace context, or null if outside any trace scope.
 * Most callers should prefer currentTraceId() for the common case.
 */
export function currentTrace(): TraceContext | null {
  return storage.getStore() ?? null;
}

/** Returns the current trace ID, generating a fresh one if outside any scope. */
export function currentTraceId(): string {
  return storage.getStore()?.traceId ?? newTraceId();
}

/**
 * Mutate the current trace context to attach (or update) hierarchy fields.
 * No-op if called outside a trace scope.
 */
export function attachToTrace(fields: Partial<Omit<TraceContext, 'traceId'>>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, fields);
}
