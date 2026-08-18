// =============================================================================
// Tests: "success" was three different things, and one of them was nothing
//
// `lifecycle_rules.success_count` is the number a founder reads as "this rule
// worked". It counted:
//
//   • a note written to a customer record          — an action carried out
//   • an escalation, which is also a note           — the same
//   • an action type Foundry does not implement     — NOTHING
//
// The third is the sharp one. An unrecognised action type wrote "[RULE: x]
// Action type 'y' triggered" and returned true, so a rule configured with an
// action that does not exist reported success every time it fired, for as long
// as it existed.
//
// §16: one field must not mean execution succeeded AND provider accepted AND
// the objective was achieved. This table has never observed the third, and it
// now says so: `carried_out` claims the action ran, not that it helped.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { evaluateLifecycleRules } from '../../src/services/customer/lifecycle.js';

const F = 'rs_founder';
const P = 'rs_product';
const C = 'rs_customer';

async function rule(id: string, actionType: string): Promise<void> {
  await query(
    `INSERT INTO lifecycle_rules
       (id, product_id, name, trigger_event, trigger_conditions, action_type,
        action_agent, action_parameters, enabled)
     VALUES (?, ?, ?, 'stage_changed', ?, ?, 'harbor', '{}', 1)`,
    [id, P, `rule ${id}`, JSON.stringify({ stage: 'paying' }), actionType]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'rs_clerk', 'rs@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?,'Rules Co',?, 'active')`,
    [P, F]);
  // `customer_intelligence`, which is what the evaluator reads — `customers` is
  // a different table with a different purpose.
  await query(
    `INSERT INTO customer_intelligence
       (id, product_id, external_customer_id, email, stage, health_score)
     VALUES (?,?, 'ext_1', 'c@example.com', 'paying', 50)`, [C, P]);
});

beforeEach(async () => {
  await query('DELETE FROM lifecycle_rule_triggers WHERE product_id = ?', [P]);
  await query('DELETE FROM lifecycle_rules WHERE product_id = ?', [P]);
});

describe('a rule that does nothing does not report success', () => {
  it('records an unimplemented action type as unsupported', async () => {
    await rule('rs_unknown', 'send_carrier_pigeon');
    await evaluateLifecycleRules(P);

    const trigger = (await query(
      `SELECT outcome FROM lifecycle_rule_triggers WHERE rule_id = 'rs_unknown'`))
      .rows[0] as Record<string, string>;
    expect(trigger.outcome,
      'an action type with no implementation did not succeed at anything')
      .toBe('unsupported_action');

    const counts = (await query(
      `SELECT times_triggered, success_count, failure_count
         FROM lifecycle_rules WHERE id = 'rs_unknown'`))
      .rows[0] as Record<string, number>;
    expect(Number(counts.times_triggered), 'the rule did fire').toBe(1);
    expect(Number(counts.success_count),
      'success_count is what a founder reads as "this rule worked"').toBe(0);
    expect(Number(counts.failure_count),
      'nothing was attempted, so nothing failed either').toBe(0);
  });

  it('counts an action that really was carried out', async () => {
    await rule('rs_note', 'add_note');
    await evaluateLifecycleRules(P);

    const trigger = (await query(
      `SELECT outcome FROM lifecycle_rule_triggers WHERE rule_id = 'rs_note'`))
      .rows[0] as Record<string, string>;
    expect(trigger.outcome).toBe('carried_out');
    const counts = (await query(
      `SELECT success_count FROM lifecycle_rules WHERE id = 'rs_note'`))
      .rows[0] as Record<string, number>;
    expect(Number(counts.success_count)).toBe(1);
  });

  it('does not count an unsupported action as an action created', async () => {
    await rule('rs_unknown2', 'teleport_the_customer');
    const result = await evaluateLifecycleRules(P);
    expect(result.actions_created,
      'an action type with no implementation created no action').toBe(0);
    expect(result.rules_triggered, 'the rule still matched and fired').toBe(1);
  });

  it('says plainly in the note that nothing was done', async () => {
    // The note is what a founder reads on the customer record. "Action type 'x'
    // triggered" reads as something having happened.
    await rule('rs_unknown3', 'invent_a_product');
    await evaluateLifecycleRules(P);
    const row = (await query(
      `SELECT agent_notes FROM customer_intelligence WHERE id = ?`, [C]))
      .rows[0] as Record<string, string>;
    expect(row.agent_notes ?? '').toMatch(/not implemented|nothing was done/i);
  });
});

describe('carried out is not the same as it worked', () => {
  it('claims execution, never a business outcome', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(__dirname, '../../src/services/customer/lifecycle.ts'), 'utf8');
    // The vocabulary is the point: nothing in this table observes whether the
    // customer was helped, so no value may imply it.
    expect(src).toMatch(/type RuleTriggerOutcome/);
    expect(src).toMatch(/'carried_out'/);
    expect(src, 'a generic success would mean all three things again')
      .not.toMatch(/outcome: 'success' \| 'failure' \| 'pending'/);
  });
});
