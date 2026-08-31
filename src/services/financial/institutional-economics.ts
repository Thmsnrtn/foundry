// =============================================================================
// FOUNDRY — what it costs to carry a responsibility
//
// The institutional economic invariant is: maximise defensible company value
// per unit of money, computation, time, attention and risk, under quality,
// safety, evidence and owner-governance constraints. None of that is executable
// while cost is attributed to agent personas, so migration 134 attached cost to
// the responsibility and capability it was incurred for, and this reads it back.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
//
//   measured-and-zero is not the same fact as not-measured.
//
// A total that silently folds unmeasured components into 0 produces an
// economics that looks complete and is not — and it would understate exactly
// the costs that are hardest to see, which are the ones that decide whether
// automating something was worth it. So every reported figure is a sum of
// things actually recorded, and everything known to be missing is named.
//
// WHY "MODEL SPEND = 0" IS A REAL MEASUREMENT HERE. The institutional kernel is
// structurally model-free — the cognition gate fails the build if any kernel
// module can reach a model. So zero model spend on an institutional path is not
// an absence of data; it is a fact enforced by a gate. That makes it a genuine
// baseline for any future cognition to be compared against, which is the whole
// reason to establish it before a model exists.
// =============================================================================

import { query } from '../../db/client.js';

/** Cost components that no current code path measures. Named, not zeroed.
 *
 * Each entry is a real component of what carrying a responsibility costs, which
 * this system genuinely does not observe today. Listing them is what keeps
 * `totalUsd` honest: it is the measured total, never the total. */
export const UNMEASURED_COMPONENTS = [
  'compute_and_infrastructure — no per-request infrastructure cost is observed',
  'founder_time — founder-authored work is counted in events, never priced',
  'founder_intervention — corrections and re-work are not distinguished from first-pass work',
  'provider_send_price — the email provider bills out of band; no per-send price is recorded',
  'retries_and_reconciliation — retry attempts are not separately costed',
  'failure_and_exception_cost — the cost of an effect that went wrong is not observed',
  'risk — carried but not quantified; deliberately not modelled',
] as const;

export interface ResponsibilityCost {
  productId: string;
  responsibilityId: string | null;
  capability: string | null;
  /** Sums over cost events that were actually recorded. */
  measured: {
    modelUsd: number;
    providerUsd: number;
    otherUsd: number;
    totalUsd: number;
    events: number;
  };
  /** Countable institutional facts that are not priced. Volume, not money —
   * saying "three founder-authored replies" is true, while assigning them a
   * dollar value would not be. */
  counted: {
    effectsExecuted: number;
    founderAuthoredReplies: number;
  };
  /** Everything above that is missing from `measured`. */
  unmeasured: readonly string[];
}

const MODEL_TYPES = ['llm_tokens'];
const PROVIDER_TYPES = ['email_send', 'integration_api'];

/**
 * What was actually spent carrying one responsibility.
 *
 * Returns measured sums and counted volumes separately, and never invents a
 * price for either. A responsibility with no recorded cost events reports zero
 * measured spend and the full unmeasured list — which correctly reads as "we
 * know of no spend, and we are not claiming this was free".
 */
export async function getResponsibilityCost(
  productId: string, responsibilityId: string,
): Promise<ResponsibilityCost> {
  const rows = (await query(
    `SELECT cost_type, amount_usd FROM cost_events
      WHERE product_id=? AND responsibility_id=?`,
    [productId, responsibilityId],
  )).rows as unknown as Array<Record<string, unknown>>;

  let modelUsd = 0; let providerUsd = 0; let otherUsd = 0;
  for (const row of rows) {
    const amount = Number(row.amount_usd ?? 0);
    const type = String(row.cost_type ?? '');
    if (MODEL_TYPES.includes(type)) modelUsd += amount;
    else if (PROVIDER_TYPES.includes(type)) providerUsd += amount;
    else otherUsd += amount;
  }

  const capabilityRow = (await query(
    'SELECT capability FROM institutional_responsibilities WHERE id=? AND product_id=?',
    [responsibilityId, productId],
  )).rows[0] as Record<string, unknown> | undefined;

  // Volume of consequential effects actually dispatched for this
  // responsibility, and how many replies a human wrote. Both are countable from
  // canonical records; neither is money.
  const effects = (await query(
    "SELECT COUNT(*) n FROM outbound_actions WHERE product_id=? AND responsibility_id=? AND status='executed'",
    [productId, responsibilityId],
  )).rows[0] as Record<string, unknown>;

  // Founder-authored replies are canonical signal events, not a separate
  // store — proposals were deliberately built as evidence rather than as a
  // table of drafts. Counting them means joining through the message they were
  // written for, which is also what binds them to this responsibility.
  const replies = (await query(
    `SELECT COUNT(*) n FROM signal_events s
      WHERE s.product_id=? AND s.source='founder_reply_proposal'
        AND json_extract(s.payload_json,'$.message_id') IN (
          SELECT m.id FROM inbound_customer_messages m
           WHERE m.product_id=? AND m.responsibility_id=?)`,
    [productId, productId, responsibilityId],
  )).rows[0] as Record<string, unknown>;

  return {
    productId, responsibilityId,
    capability: capabilityRow ? String(capabilityRow.capability) : null,
    measured: {
      modelUsd, providerUsd, otherUsd,
      totalUsd: modelUsd + providerUsd + otherUsd,
      events: rows.length,
    },
    counted: {
      effectsExecuted: Number(effects.n ?? 0),
      founderAuthoredReplies: Number(replies.n ?? 0),
    },
    unmeasured: UNMEASURED_COMPONENTS,
  };
}

/** The same question asked per capability, which is the unit a founder actually
 * decides about — they choose whether Foundry handles support, not whether it
 * handles one particular support thread. */
export async function getCapabilityCost(
  productId: string, capability: string,
): Promise<ResponsibilityCost> {
  const rows = (await query(
    'SELECT cost_type, amount_usd FROM cost_events WHERE product_id=? AND capability=?',
    [productId, capability],
  )).rows as unknown as Array<Record<string, unknown>>;

  let modelUsd = 0; let providerUsd = 0; let otherUsd = 0;
  for (const row of rows) {
    const amount = Number(row.amount_usd ?? 0);
    const type = String(row.cost_type ?? '');
    if (MODEL_TYPES.includes(type)) modelUsd += amount;
    else if (PROVIDER_TYPES.includes(type)) providerUsd += amount;
    else otherUsd += amount;
  }

  const effects = (await query(
    `SELECT COUNT(*) n FROM outbound_actions o
       JOIN institutional_responsibilities r ON r.id=o.responsibility_id
      WHERE o.product_id=? AND r.capability=? AND o.status='executed'`,
    [productId, capability],
  )).rows[0] as Record<string, unknown>;

  return {
    productId, responsibilityId: null, capability,
    measured: {
      modelUsd, providerUsd, otherUsd,
      totalUsd: modelUsd + providerUsd + otherUsd,
      events: rows.length,
    },
    counted: { effectsExecuted: Number(effects.n ?? 0), founderAuthoredReplies: 0 },
    unmeasured: UNMEASURED_COMPONENTS,
  };
}
