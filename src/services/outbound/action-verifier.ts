// =============================================================================
// FOUNDRY — Action Verifier (Jarvis evolution axis 1 — verified ACTION)
//
// The letter verifier's sibling, pointed at deeds instead of words. Contract:
//   1. BEFORE an act-tier execution, the actor declares explicit, checkable
//      success criteria and a verification window.
//   2. AFTER the window, an INDEPENDENT sweep re-reads the ledgers fresh —
//      it trusts nothing the actor recorded about itself.
//   3. Pass → verified on the record (the trust ladder's evidence).
//      Fail → an audit defect ("what did you do that didn't work?") AND a
//      trust anomaly: the acting autopilot category is demoted one rung via
//      the EXISTING recordAnomaly machinery. Bad acts cost autonomy.
//
// Criteria are deterministic by design — no model judges success.
// =============================================================================

import { query, insertAuditLog } from '../../db/client.js';
import { nanoid } from 'nanoid';
import { log } from '../../lib/logger.js';

export type CriteriaKind =
  | 'provider_accepted'              // the execution completed without error
  | 'no_error_recorded'              // still no error_message at check time
  | 'customer_health_not_worse';     // customer's health ≥ baseline − tolerance

export interface ActionCriterion {
  kind: CriteriaKind;
  customer_id?: string;
  baseline_health?: number | null;
  tolerance?: number;                // default 0.05
}

/** Declare what success means BEFORE the consequences arrive. */
export async function declareCriteria(
  executionId: string,
  criteria: ActionCriterion[],
  verifyAfterHours: number,
): Promise<void> {
  await query(
    `UPDATE action_executions
        SET verify_criteria = ?, verify_status = 'pending',
            verify_after = datetime('now', '+${Math.max(0, Math.floor(verifyAfterHours))} hours')
      WHERE id = ?`,
    [JSON.stringify(criteria), executionId],
  );
}

interface DueExecution {
  id: string;
  product_id: string;
  status: string;
  error_message: string | null;
  approved_by: string | null;
  verify_criteria: string;
}

async function checkCriterion(c: ActionCriterion, exec: DueExecution): Promise<string | null> {
  switch (c.kind) {
    case 'provider_accepted':
      return exec.status === 'completed' ? null : `execution status is '${exec.status}', not completed`;
    case 'no_error_recorded':
      return exec.error_message == null ? null : `error recorded: ${exec.error_message}`;
    case 'customer_health_not_worse': {
      if (!c.customer_id || c.baseline_health == null) return null; // nothing checkable — vacuous pass
      // ASKED THROUGH THE ACCESSOR, NOT ONE TABLE. This read `customers` by id.
      // A customer reported through the documented external API lives in
      // `customer_intelligence`, so the lookup found no row and this abstained
      // — a vacuous pass, forever, for exactly the customers the department can
      // now act on. Abstaining is right when there is no fresh data and wrong
      // when the data is in the other table.
      const { getCustomerHealth } = await import('../institution/company-customers.js');
      const health = await getCustomerHealth(exec.product_id, c.customer_id);
      if (health === null) return null; // no fresh data — abstain, don't fail
      const now = health;
      const floor = Number(c.baseline_health) - (c.tolerance ?? 0.05);
      return now >= floor ? null : `customer health ${now.toFixed(2)} fell below baseline floor ${floor.toFixed(2)}`;
    }
  }
}

export interface VerifySweepResult {
  checked: number;
  passed: number;
  failed: number;
}

/** The independent pass: verify every execution whose window has elapsed. */
export async function verifyDueActions(): Promise<VerifySweepResult> {
  const due = (await query(
    `SELECT id, product_id, status, error_message, approved_by, verify_criteria
       FROM action_executions
      WHERE verify_status = 'pending' AND verify_after <= datetime('now')
      LIMIT 100`,
    // DELIBERATELY NOT NARROWED TO OPERATING COMPANIES, unlike the bounded
    // queues that feed paid model calls. The effect has already gone out; what
    // is left is finding out how it landed, and a founder whose subscription
    // lapsed the day after Foundry emailed their customer is owed that answer
    // more than anyone. Nothing here spends, so nothing here can be refused and
    // silently re-queued.
    [],
  )).rows as unknown as DueExecution[];

  const result: VerifySweepResult = { checked: 0, passed: 0, failed: 0 };

  for (const exec of due) {
    let criteria: ActionCriterion[] = [];
    try { criteria = JSON.parse(exec.verify_criteria) as ActionCriterion[]; } catch { /* malformed → fail below */ }

    const failures: string[] = [];
    for (const c of criteria) {
      const failure = await checkCriterion(c, exec);
      if (failure) failures.push(`${c.kind}: ${failure}`);
    }
    if (criteria.length === 0) failures.push('malformed or empty criteria — an act without checkable success is a defect');

    result.checked++;
    if (failures.length === 0) {
      result.passed++;
      await query(
        `UPDATE action_executions SET verify_status = 'passed', verified_at = datetime('now') WHERE id = ?`,
        [exec.id],
      );
      continue;
    }

    result.failed++;
    await query(
      `UPDATE action_executions SET verify_status = 'failed', verified_at = datetime('now') WHERE id = ?`,
      [exec.id],
    );
    await insertAuditLog({
      id: nanoid(),
      product_id: exec.product_id,
      action_type: 'action:verifier',
      gate: 0,
      trigger: `action_verify/${exec.id}`,
      reasoning: failures.join(' | '),
      input_context: JSON.stringify({ execution_id: exec.id }),
      output: undefined,
      outcome: 'refused',
    });

    // Bad acts cost autonomy: an autopilot-approved execution that failed its
    // own success criteria demotes the acting category one rung.
    const approver = exec.approved_by ?? '';
    if (approver.startsWith('autopilot:')) {
      const category = approver.slice('autopilot:'.length);
      const { recordAnomaly } = await import('../autopilot/policy.js');
      await recordAnomaly(exec.product_id, category, `action ${exec.id} failed verification: ${failures[0]}`);
    }
    log.warn('action verification failed', { executionId: exec.id, productId: exec.product_id, failures });
  }

  return result;
}
