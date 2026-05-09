// =============================================================================
// FOUNDRY — Error Reporter
// One hook for upstream error tracking (Sentry / Honeybadger / equivalent).
// Currently a no-op stub: log.error already prints structured output. When
// SENTRY_DSN is configured, register a real reporter via setReporter() at
// boot. The stub keeps every call site honest without forcing a vendor
// dependency before there's a vendor decision.
// =============================================================================

import { currentTrace } from './trace.js';

export interface ErrorReportContext {
  /** Where the error fired — service / route / job name. */
  source?: string;
  /** Per-product / per-founder context to scope the report. */
  productId?: string;
  founderId?: string;
  agentName?: string;
  /** Anything else useful — kept JSON-serializable. */
  meta?: Record<string, unknown>;
}

export type ErrorReporter = (err: unknown, ctx: ErrorReportContext) => void;

// ─── Default reporter: emits a structured stderr line so the trace is
//     recoverable from Fly logs even before a vendor is wired up.

const defaultReporter: ErrorReporter = (err, ctx) => {
  const traceCtx = currentTrace();
  const payload = {
    type: 'error_report',
    timestamp: new Date().toISOString(),
    error_message: err instanceof Error ? err.message : String(err),
    error_name: err instanceof Error ? err.name : undefined,
    error_stack: err instanceof Error ? err.stack : undefined,
    trace_id: traceCtx?.traceId ?? null,
    founder_id: ctx.founderId ?? traceCtx?.founderId ?? null,
    product_id: ctx.productId ?? traceCtx?.productId ?? null,
    agent: ctx.agentName ?? traceCtx?.agentName ?? null,
    source: ctx.source ?? null,
    meta: ctx.meta ?? null,
  };
  // stderr so it's separable from regular structured logs in tail/grep.
  process.stderr.write(JSON.stringify(payload) + '\n');
};

let activeReporter: ErrorReporter = defaultReporter;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a real error reporter (e.g. Sentry.captureException) at boot.
 * Pass null to fall back to the structured-stderr default.
 */
export function setReporter(reporter: ErrorReporter | null): void {
  activeReporter = reporter ?? defaultReporter;
}

/**
 * Report an error. Non-throwing, non-blocking. Safe to call from anywhere.
 */
export function reportError(err: unknown, ctx: ErrorReportContext = {}): void {
  try {
    activeReporter(err, ctx);
  } catch {
    /* a broken reporter must never escalate */
  }
}
