// =============================================================================
// FOUNDRY — Error Reporter
// One hook for upstream error tracking (Sentry / Honeybadger / equivalent).
//
// Activation order at boot (initReporter is called once from src/index.ts):
//   1. SENTRY_DSN env set + @sentry/node installed → Sentry reporter.
//   2. ERROR_LOG_PATH env set → append-only JSON-line file at that path.
//      Useful during alpha when you want a persistent trail without
//      committing to a vendor.
//   3. Default → structured stderr (always recoverable from Fly logs).
//
// Call sites (reportError) never change. The seam is the active reporter.
// =============================================================================

import { appendFile } from 'node:fs/promises';
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

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Wire up the appropriate reporter based on environment. Idempotent and
 * safe to call multiple times. Should be called once at boot from
 * src/index.ts before any request handlers run.
 *
 * Selection precedence:
 *   - SENTRY_DSN + @sentry/node installed → Sentry.captureException
 *   - ERROR_LOG_PATH                       → append JSON lines to file
 *   - default                              → structured stderr
 */
export async function initReporter(): Promise<void> {
  if (process.env.SENTRY_DSN) {
    const sentryReporter = await trySentryReporter();
    if (sentryReporter) {
      setReporter(sentryReporter);
      return;
    }
    // SENTRY_DSN was set but @sentry/node isn't installed. Fall through
    // to the next option; print a one-line warning so the operator
    // knows. Don't throw — a missing dep must not block boot.
    process.stderr.write(
      JSON.stringify({
        type: 'reporter_init_warning',
        message: 'SENTRY_DSN set but @sentry/node not installed — falling back',
      }) + '\n'
    );
  }

  if (process.env.ERROR_LOG_PATH) {
    setReporter(buildFileReporter(process.env.ERROR_LOG_PATH));
    return;
  }
  // Default reporter is already active.
}

// ─── Reporters ────────────────────────────────────────────────────────────────

async function trySentryReporter(): Promise<ErrorReporter | null> {
  try {
    // Dynamic import via a string-typed specifier so TypeScript doesn't
    // demand @sentry/node be installed at type-check time. The actual
    // import only runs at boot when SENTRY_DSN is set.
    const moduleName = '@sentry/node';
    const sentry = (await (import(moduleName) as Promise<unknown>).catch(() => null)) as
      | { init?: (opts: Record<string, unknown>) => void; captureException?: (err: unknown, ctx?: unknown) => void }
      | null;
    if (!sentry || typeof sentry.init !== 'function' || typeof sentry.captureException !== 'function') {
      return null;
    }
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0,
    });
    return (err, ctx) => {
      const traceCtx = currentTrace();
      sentry.captureException!(err, {
        tags: {
          source: ctx.source,
          agent: ctx.agentName ?? traceCtx?.agentName,
        },
        extra: {
          trace_id: traceCtx?.traceId,
          founder_id: ctx.founderId ?? traceCtx?.founderId,
          product_id: ctx.productId ?? traceCtx?.productId,
          ...ctx.meta,
        },
      });
    };
  } catch {
    return null;
  }
}

function buildFileReporter(path: string): ErrorReporter {
  return (err, ctx) => {
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
    // Fire-and-forget. Failure to write to disk falls back to stderr so
    // we never lose the report.
    appendFile(path, JSON.stringify(payload) + '\n').catch(() => {
      defaultReporter(err, ctx);
    });
  };
}
