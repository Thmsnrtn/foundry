// =============================================================================
// FOUNDRY — Tool Gateway (V3.1 Layer C)
// Top-level entry point for outbound tool invocations. Runs four pre-flight
// checks (kill-switch, classification, budget, idempotency) before delegating
// to a registered tool handler. Records every invocation to audit_log.
//
// Existing integrations are NOT migrated to call this in this commit; they
// continue to use src/services/outbound/executor.ts directly. Adapter
// migration order is documented in src/services/outbound/README.md.
// =============================================================================

import { checkKillSwitch } from './kill-switch.js';
import { checkAllowed } from './classification.js';
import { checkAndIncrement } from './budget.js';
import { checkAndReserve, storeResult, releaseReservation } from './idempotency.js';
import { recordGatewayInvocation, newInvocationId } from './audit.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GatewayRequest {
  productId: string;
  agent: string;                              // agent name or 'system'
  tool: string;                               // 'send_email'|'create_pr'|...
  action: string;                             // human-readable description
  params: Record<string, unknown>;
  /** Required for at-most-once dedup. Without it, idempotency is skipped. */
  dedupKey?: string;
  /** Required to consume communication budget. Without it, budget is skipped. */
  customerExternalId?: string;
  /** Required for classification check. Without it, classification is skipped. */
  surface?: string;
  /** 'general'|'customer'|'pii_strict'|... — required when surface is set. */
  dataClass?: string;
  /** Optional override; default 7 days. */
  idempotencyTtlSeconds?: number;
}

export type RefusalPhase =
  | 'kill_switch'
  | 'classification'
  | 'budget'
  | 'in_flight'
  | 'no_handler'
  | 'execution';

export type GatewayResult =
  | {
      ok: true;
      invocation_id: string;
      cached: boolean;
      result: unknown;
    }
  | {
      ok: false;
      invocation_id: string;
      phase: RefusalPhase;
      reason: string;
    };

export type ToolHandler = (req: GatewayRequest) => Promise<unknown>;

const DEFAULT_IDEM_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Tool Handler Registry ────────────────────────────────────────────────────

const handlers = new Map<string, ToolHandler>();

export function registerToolHandler(tool: string, handler: ToolHandler): void {
  handlers.set(tool, handler);
}

export function clearToolHandlers(): void {
  handlers.clear();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function invoke(req: GatewayRequest): Promise<GatewayResult> {
  const invocationId = newInvocationId();

  // 1. Kill-switch
  const ks = await checkKillSwitch(req.productId, req.tool, req.agent);
  if (ks.blocked) {
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: req.agent,
      tool: req.tool,
      action: req.action,
      outcome: 'refused',
      reason: `kill_switch: ${ks.reason}`,
    });
    return { ok: false, invocation_id: invocationId, phase: 'kill_switch', reason: ks.reason };
  }

  // 2. Classification (only when caller declares a surface)
  if (req.surface) {
    const dataClass = req.dataClass ?? 'general';
    const cls = await checkAllowed(req.productId, req.surface, dataClass);
    if (!cls.allowed) {
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: req.agent,
        tool: req.tool,
        action: req.action,
        outcome: 'refused',
        reason: `classification: ${cls.reason}`,
      });
      return {
        ok: false,
        invocation_id: invocationId,
        phase: 'classification',
        reason: cls.reason,
      };
    }
  }

  // 3. Idempotency reservation (only when dedupKey provided). Checked BEFORE
  // the budget so a deduped retry — which does no work — never burns a unit
  // of the customer's weekly communication budget.
  let freshReservation = false;
  if (req.dedupKey) {
    const ttl = req.idempotencyTtlSeconds ?? DEFAULT_IDEM_TTL_SECONDS;
    const reserved = await checkAndReserve(
      req.productId,
      req.tool,
      req.dedupKey,
      ttl,
      req.agent && req.agent !== 'system' ? req.agent : null
    );
    if (!reserved.fresh) {
      // A stored result is a genuine cached success. A reservation with NO
      // stored result means the prior attempt is still running (or died) —
      // reporting that as success would tell the caller work happened that
      // never did. Fail honestly; the failed-attempt path below releases its
      // reservation, so a real retry gets through.
      if (reserved.cached !== null) {
        await recordGatewayInvocation({
          invocation_id: invocationId,
          product_id: req.productId,
          agent: req.agent,
          tool: req.tool,
          action: req.action,
          outcome: 'cached',
          reason: `idempotency hit on ${req.dedupKey}`,
          result_summary: 'cached result returned',
        });
        return {
          ok: true,
          invocation_id: invocationId,
          cached: true,
          result: reserved.cached,
        };
      }
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: req.agent,
        tool: req.tool,
        action: req.action,
        outcome: 'refused',
        reason: `idempotency: reservation in flight for ${req.dedupKey}`,
      });
      return {
        ok: false,
        invocation_id: invocationId,
        phase: 'in_flight',
        reason: `a call with dedup key ${req.dedupKey} is already in flight`,
      };
    }
    freshReservation = true;
  }

  // On any failure after a fresh reservation, release it so a retry can work.
  const releaseIfReserved = async () => {
    if (freshReservation && req.dedupKey) {
      await releaseReservation(req.productId, req.tool, req.dedupKey).catch(() => {});
    }
  };

  // 4. Communication budget (only when a customer key is provided)
  if (req.customerExternalId) {
    const week = currentWeekStart();
    const budget = await checkAndIncrement(req.productId, req.customerExternalId, week);
    if (!budget.allowed) {
      await releaseIfReserved();
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: req.agent,
        tool: req.tool,
        action: req.action,
        outcome: 'refused',
        reason: `budget: cap ${budget.cap} reached for week ${week}`,
      });
      return {
        ok: false,
        invocation_id: invocationId,
        phase: 'budget',
        reason: `cap ${budget.cap} reached for week ${week}`,
      };
    }
  }

  // 5. Dispatch to registered handler
  const handler = handlers.get(req.tool);
  if (!handler) {
    await releaseIfReserved();
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: req.agent,
      tool: req.tool,
      action: req.action,
      outcome: 'failed',
      reason: `no handler registered for tool '${req.tool}'`,
    });
    return {
      ok: false,
      invocation_id: invocationId,
      phase: 'no_handler',
      reason: `no handler registered for tool '${req.tool}'`,
    };
  }

  let result: unknown;
  try {
    result = await handler(req);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Release the reservation: a failed attempt must not convert every
    // subsequent retry into a fake cached success for the TTL window.
    await releaseIfReserved();
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: req.agent,
      tool: req.tool,
      action: req.action,
      outcome: 'failed',
      reason: `execution: ${reason}`,
    });
    return {
      ok: false,
      invocation_id: invocationId,
      phase: 'execution',
      reason,
    };
  }

  // 6. Cache result + audit
  if (req.dedupKey) {
    await storeResult(req.productId, req.tool, req.dedupKey, result);
  }
  await recordGatewayInvocation({
    invocation_id: invocationId,
    product_id: req.productId,
    agent: req.agent,
    tool: req.tool,
    action: req.action,
    outcome: 'allowed',
    reason: 'pre-flight passed; handler succeeded',
  });
  return { ok: true, invocation_id: invocationId, cached: false, result };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentWeekStart(d: Date = new Date()): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}
