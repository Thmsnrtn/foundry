// =============================================================================
// FOUNDRY — Tool Gateway (V3.1 Layer C)
// Top-level entry point for outbound tool invocations. Runs four pre-flight
// checks (kill-switch, classification, budget, idempotency) before delegating
// to a registered tool handler. Records every invocation to audit_log.
//
// Registered capability policy, rather than request data, supplies safety
// classification and execution identity.
// =============================================================================

import { checkKillSwitch } from './kill-switch.js';
import { checkAllowed } from './classification.js';
import { checkAndIncrement } from './budget.js';
import { checkAndReserve, storeResult, releaseReservation } from './idempotency.js';
import { recordGatewayInvocation, newInvocationId } from './audit.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GatewayRequest {
  productId: string;
  tool: string;                               // 'send_email'|'create_pr'|...
  action: string;                             // human-readable description
  params: Record<string, unknown>;
  /** Required for at-most-once dedup. Without it, idempotency is skipped. */
  dedupKey?: string;
  /** Customer fact used by policies that require communication budgeting. */
  customerExternalId?: string;
  /** Legacy assertion checked against, but never overrides, server policy. */
  surface?: string;
  /** Legacy assertion checked against, but never overrides, server policy. */
  dataClass?: string;
  /** Optional override; default 7 days. */
  idempotencyTtlSeconds?: number;
}

export type RefusalPhase =
  | 'kill_switch'
  | 'policy'
  | 'classification'
  | 'budget'
  | 'in_flight'
  | 'no_handler'
  | 'contact_refused'
  | 'execution'
  // A handler refused before touching the provider. 'execution' means "the
  // handler ran and we do not know what reached the outside world", which is
  // why callers schedule reconciliation on it. A refusal decided inside the
  // handler — the sender-of-record rule, a missing company sending identity —
  // is the opposite: definitively nothing was attempted. Filing one under the
  // other makes a message that never left the building look like one that
  // might have, and books reconciliation work for an effect that does not
  // exist.
  | 'refused';

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

/** Trusted, server-owned controls for a capability. Callers may supply facts
 * such as a dedup key or customer id, but may not choose the safety policy. */
export interface ToolPolicy {
  /** Server-owned execution identity. Request data can never override it. */
  actor: string;
  surface: string;
  dataClass: string;
  requireDedupKey: boolean;
  requireCustomerExternalId: boolean;
  /**
   * Survives a company pause. Almost nothing should: a paused company reaches
   * nobody. The exception is Foundry's own account mail to its own customer —
   * "your trial has ended", "your subscription is cancelled and here is when
   * access stops" — which every subscription product delivers regardless of
   * plan state, and which a founder cannot be left without, since the reason
   * they are paused is exactly what it explains.
   *
   * It is a property of the REGISTERED capability, never of the request. A
   * caller chooses a tool name; the server chooses what that tool may do. The
   * one tool that carries this flag also builds its own body from a fixed set
   * of notice kinds, so naming it does not buy the ability to send anything.
   */
  deliverableWhilePaused?: boolean;
}

const DEFAULT_IDEM_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// ─── Tool Handler Registry ────────────────────────────────────────────────────

const handlers = new Map<string, ToolHandler>();
const policies = new Map<string, ToolPolicy>();

export function registerToolHandler(tool: string, handler: ToolHandler, policy: ToolPolicy): void {
  handlers.set(tool, handler);
  policies.set(tool, policy);
}

export function clearToolHandlers(): void {
  handlers.clear();
  policies.clear();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function invoke(req: GatewayRequest): Promise<GatewayResult> {
  const invocationId = newInvocationId();

  const policy = policies.get(req.tool);
  if (!policy) {
    return refusePolicy(invocationId, req, `no trusted policy registered for tool '${req.tool}'`);
  }

  // 1. Kill-switch
  const ks = await checkKillSwitch(req.productId, req.tool, policy.actor, {
    deliverableWhilePaused: policy.deliverableWhilePaused === true,
  });
  if (ks.blocked) {
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: policy.actor,
      tool: req.tool,
      action: req.action,
      outcome: 'refused',
      reason: `kill_switch: ${ks.reason}`,
    });
    return { ok: false, invocation_id: invocationId, phase: 'kill_switch', reason: ks.reason };
  }

  // 2. Server-owned tool policy. A caller cannot skip or downgrade controls by
  // omitting classification/budget facts or by declaring a safer surface.
  if (req.surface && req.surface !== policy.surface) {
    return refusePolicy(invocationId, req, `surface is fixed to '${policy.surface}'`);
  }
  if (req.dataClass && req.dataClass !== policy.dataClass) {
    return refusePolicy(invocationId, req, `data class is fixed to '${policy.dataClass}'`);
  }
  if (policy.requireDedupKey && !req.dedupKey) {
    return refusePolicy(invocationId, req, 'dedup key is required');
  }
  if (policy.requireCustomerExternalId && !req.customerExternalId) {
    return refusePolicy(invocationId, req, 'customer external id is required');
  }

  // 2b. THE PERSON THIS REACHES MAY HAVE SAID NO.
  //
  // Owner authority answers whether this actor may act. It does not answer
  // whether this may be done to THIS person, and the person an effect reaches
  // is not represented by the founder's permission. Migration 094 stated the
  // rule on its face — "never contacted again, by any mode, at any trust
  // level" — and one department consulted it while the governed path did not.
  //
  // Checked HERE because this is where every outward effect converges, so no
  // caller has to remember it. `requireCustomerExternalId` already means "this
  // effect is addressed to an identified party", so the condition is a property
  // of the registered capability rather than a new field a caller could omit.
  if (policy.requireCustomerExternalId && req.customerExternalId) {
    const { contactIsRefused } = await import('../institution/contact-constraint.js');
    const constraint = await contactIsRefused(req.productId, req.customerExternalId);
    if (constraint.refused) {
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: policy.actor,
        tool: req.tool,
        action: req.action,
        outcome: 'refused',
        reason: `contact_refused: ${constraint.reason}`,
      });
      return {
        ok: false,
        invocation_id: invocationId,
        phase: 'contact_refused',
        reason: constraint.reason,
      };
    }
  }

  // 3. Classification is mandatory and derived from the registered policy.
  {
    const cls = await checkAllowed(req.productId, policy.surface, policy.dataClass);
    if (!cls.allowed) {
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: policy.actor,
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

  // 4. Idempotency reservation (only when dedupKey provided). Checked BEFORE
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
      policy.actor !== 'system' ? policy.actor : null
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
          agent: policy.actor,
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
        agent: policy.actor,
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

  // 5. Communication budget (only when a customer key is provided)
  if (req.customerExternalId) {
    const week = currentWeekStart();
    const budget = await checkAndIncrement(req.productId, req.customerExternalId, week);
    if (!budget.allowed) {
      await releaseIfReserved();
      await recordGatewayInvocation({
        invocation_id: invocationId,
        product_id: req.productId,
        agent: policy.actor,
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

  // 6. Dispatch to registered handler
  const handler = handlers.get(req.tool);
  if (!handler) {
    await releaseIfReserved();
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: policy.actor,
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
    // A handler may declare that it refused before reaching the provider.
    // Nothing more elaborate than a flag on the error: the alternative is a
    // taxonomy of failure types nobody would keep accurate.
    const definitivelyNotAttempted =
      typeof err === 'object' && err !== null
      && (err as { notAttempted?: unknown }).notAttempted === true;
    // Release the reservation: a failed attempt must not convert every
    // subsequent retry into a fake cached success for the TTL window.
    await releaseIfReserved();
    await recordGatewayInvocation({
      invocation_id: invocationId,
      product_id: req.productId,
      agent: policy.actor,
      tool: req.tool,
      action: req.action,
      outcome: 'failed',
      reason: `${definitivelyNotAttempted ? 'refused' : 'execution'}: ${reason}`,
    });
    return {
      ok: false,
      invocation_id: invocationId,
      phase: definitivelyNotAttempted ? 'refused' : 'execution',
      reason,
    };
  }

  // 7. Cache result + audit
  if (req.dedupKey) {
    await storeResult(req.productId, req.tool, req.dedupKey, result);
  }
  await recordGatewayInvocation({
    invocation_id: invocationId,
    product_id: req.productId,
    agent: policy.actor,
    tool: req.tool,
    action: req.action,
    outcome: 'allowed',
    reason: 'pre-flight passed; handler succeeded',
  });
  return { ok: true, invocation_id: invocationId, cached: false, result };
}

async function refusePolicy(
  invocationId: string,
  req: GatewayRequest,
  reason: string,
): Promise<GatewayResult> {
  const actor = policies.get(req.tool)?.actor ?? 'gateway';
  await recordGatewayInvocation({
    invocation_id: invocationId, product_id: req.productId, agent: actor,
    tool: req.tool, action: req.action, outcome: 'refused', reason: `policy: ${reason}`,
  });
  return { ok: false, invocation_id: invocationId, phase: 'policy', reason };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentWeekStart(d: Date = new Date()): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}
