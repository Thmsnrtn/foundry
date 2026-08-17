process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';
import { reportEffectOutcome } from '../../src/services/institution/effect-outcome.js';

// =============================================================================
// The outcome loop's external half had nowhere to land.
//
// Migration 137 gave `outcome_status` a supply, and `/ingest/effect-outcome`
// lets a system that can actually see the result report it. But
// `reconcileAssistedSupportEmail` — the only function that turns those
// observations into an outcome — had exactly ONE caller: the founder answering
// the question themselves in The Letter.
//
// So an outcome reported by a rota system, a delivery scan or a helpdesk sat in
// `signal_events` and changed nothing. The effect stayed `unresolved` until a
// person happened to answer it by hand, which is precisely the founder
// attention the institution exists to conserve. `reconcile_after` — written by
// the dispatch path since the day it was built — was read by nobody.
//
// Found by reading the scheduler alongside the intakes: 79 jobs, and none of
// them consumed the link this campaign spent a migration building.
//
// The pass must buy NO privilege. It calls the same canonical function the
// founder's answer calls, and that function reads only independently recorded
// evidence.
// =============================================================================

const OWNER = 'erp_owner';
const P = 'erp_co';
const OTHER = 'erp_other';

const pass = JOB_REGISTRY.institutional_effect_reconciliation.fn;

/** An executed effect, through the real bindings. */
async function executedEffect(
  productId: string, effectId: string, actionId: string, responsibilityId: string,
): Promise<void> {
  await query(
    `INSERT INTO outbound_actions
       (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
        preview_text,responsibility_id,authority_consent_id,authority_scope,effect_id,executed_at,outcome_status)
     VALUES (?,?,'institution:assisting','resend','send_email','executed','{}','r',
             'Send bounded responsibility notice',?,?,'send_email:responsibility_notice',?,
             datetime('now'),'unresolved')`,
    [actionId, productId, responsibilityId, `${productId}_consent`, effectId]);
}

async function company(productId: string, founderId: string, clerk: string): Promise<void> {
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [founderId, clerk, `${founderId}@example.com`]);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [productId, `Co ${productId}`, founderId, 'active']);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'repository','development_need_observed','low','{}','seed')`,
    [`${productId}_sig`, productId]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Cover the Saturday class','operations','shadowing',?)`,
    [`${productId}_resp`, productId, `signal_event:${productId}_sig`]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES (?,?,?,'operations','suggest','act','v1',?,?,'low',datetime('now','+1 day'))`,
    [`${productId}_consent`, founderId, productId, `${productId}_resp`,
      JSON.stringify(['send_email:responsibility_notice'])]);
  await query(
    'UPDATE institutional_responsibilities SET state=?,authority_ref=? WHERE id=?',
    ['assisting', `autonomy_consent:${productId}_consent`, `${productId}_resp`]);
}

async function outcomeOf(actionId: string): Promise<string> {
  return String(((await query(
    'SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId],
  )).rows[0] as Record<string, unknown>).outcome_status);
}

beforeAll(async () => {
  await runMigrations();
  await company(P, OWNER, 'erp_c1');
  await company(OTHER, 'erp_owner2', 'erp_c2');
});

describe('the scheduled reconciliation pass', () => {
  it('does not touch an effect nobody has reported on', async () => {
    await executedEffect(P, 'erp_eff_quiet', 'erp_act_quiet', `${P}_resp`);

    // Asserting only that the outcome is still `unresolved` proves nothing:
    // reconciling an effect with no evidence ALSO writes `unresolved`, so both
    // behaviours look identical from the outcome column. A mutation that
    // replaced the evidence join with `1=1` passed a version of this test that
    // checked only that.
    //
    // `reconcile_after` is the observable difference, and it is the column
    // whose absent reader started this whole finding: the dispatch path sets
    // it, and `reconcileAssistedSupportEmail` clears it. If it survives the
    // pass, the effect was genuinely left alone.
    await query("UPDATE outbound_actions SET reconcile_after=datetime('now') WHERE id=?",
      ['erp_act_quiet']);

    await pass();

    expect(await outcomeOf('erp_act_quiet')).toBe('unresolved');
    expect((await query(
      'SELECT reconcile_after FROM outbound_actions WHERE id=?', ['erp_act_quiet'],
    )).rows[0], 'an effect with no observation must not be reconciled at all')
      .not.toMatchObject({ reconcile_after: null });

    // And the pass invented no evidence of its own while looking.
    expect((await query(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='effect_outcome_report'", [P],
    )).rows[0]).toMatchObject({ n: 0 });
  });

  it('resolves an effect the outside world has answered, without a founder touching it', async () => {
    // The gap this closes. Before, this report changed nothing until a person
    // opened The Letter and answered the same question by hand.
    await executedEffect(P, 'erp_eff_ok', 'erp_act_ok', `${P}_resp`);
    await reportEffectOutcome({
      productId: P, effectId: 'erp_eff_ok', verdict: 'achieved',
      reporter: 'external:rota_system', detail: 'Ines took the class',
    });
    expect(await outcomeOf('erp_act_ok')).toBe('unresolved');

    await pass();
    expect(await outcomeOf('erp_act_ok')).toBe('verified_success');
  });

  it('resolves a failure exactly as readily as a success', async () => {
    await executedEffect(P, 'erp_eff_bad', 'erp_act_bad', `${P}_resp`);
    await reportEffectOutcome({
      productId: P, effectId: 'erp_eff_bad', verdict: 'failed',
      reporter: 'external:rota_system', detail: 'Nobody came',
    });
    await pass();
    expect(await outcomeOf('erp_act_bad')).toBe('verified_failure');
  });

  it('preserves disagreement rather than resolving it toward the convenient answer', async () => {
    await executedEffect(P, 'erp_eff_split', 'erp_act_split', `${P}_resp`);
    await reportEffectOutcome({
      productId: P, effectId: 'erp_eff_split', verdict: 'achieved', reporter: `founder:${OWNER}` });
    await reportEffectOutcome({
      productId: P, effectId: 'erp_eff_split', verdict: 'failed', reporter: 'external:rota_system' });
    await pass();
    expect(await outcomeOf('erp_act_split')).toBe('conflicting');
  });

  it('is idempotent — a second run changes nothing', async () => {
    const before = (await query(
      'SELECT id,outcome_status,learned_claim_id FROM outbound_actions WHERE product_id=? ORDER BY id', [P],
    )).rows;
    const claims = (await query(
      'SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [P])).rows[0];
    await pass();
    await pass();
    expect((await query(
      'SELECT id,outcome_status,learned_claim_id FROM outbound_actions WHERE product_id=? ORDER BY id', [P],
    )).rows).toEqual(before);
    // Reconciling twice must not accumulate a second learned claim per effect.
    expect((await query(
      'SELECT COUNT(*) n FROM reconstruction_claims WHERE product_id=?', [P])).rows[0]).toEqual(claims);
  });

  it('buys no privilege: one company\'s report never resolves another\'s effect', async () => {
    await executedEffect(OTHER, 'erp_eff_ok', 'erp_act_other', `${OTHER}_resp`);
    // Deliberately the SAME effect id, reported only for the first company.
    await pass();
    expect(await outcomeOf('erp_act_other'),
      'an effect id is not a shared name across tenants').toBe('unresolved');

    // Worth being exact about WHERE that holds. Removing the tenant clause
    // from this pass's own selection query does not break it — mutation
    // confirmed — because `reconcileAssistedSupportEmail` is itself
    // tenant-scoped and refuses an action that is not this product's. The
    // clause in the pass is defence in depth on which rows are considered,
    // not the thing that protects the outcome. Claiming otherwise would put
    // the safety story in the wrong place.
    expect((await query(
      `SELECT COUNT(*) n FROM outbound_actions
        WHERE product_id=? AND outcome_status<>'unresolved'`, [OTHER])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('does not resolve an effect because a DIFFERENT effect was reported on', async () => {
    // The case the first test cannot reach. It runs before any report exists,
    // so it cannot distinguish "matched this effect's report" from "matched no
    // report at all" — a mutation weakening the effect-id join survives it.
    //
    // By now this company has several reports, none of them about this effect.
    // Reporting is per effect, and a company having answered one question is
    // not an answer to another.
    await executedEffect(P, 'erp_eff_unasked', 'erp_act_unasked', `${P}_resp`);
    await query("UPDATE outbound_actions SET reconcile_after=datetime('now') WHERE id=?",
      ['erp_act_unasked']);
    expect((await query(
      "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='effect_outcome_report'", [P],
    )).rows[0] as Record<string, unknown>, 'this test needs other reports to exist')
      .not.toMatchObject({ n: 0 });

    await pass();

    expect(await outcomeOf('erp_act_unasked')).toBe('unresolved');
    expect((await query(
      'SELECT reconcile_after FROM outbound_actions WHERE id=?', ['erp_act_unasked'],
    )).rows[0], 'somebody else\'s answer is not an answer to this')
      .not.toMatchObject({ reconcile_after: null });
  });

  it('grants nothing and promotes nothing by learning', async () => {
    // Reconciliation is the loop's last link, not a rung on the ladder.
    expect((await query(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND state='operating'", [P],
    )).rows[0]).toMatchObject({ n: 0 });
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 1 });
  });

  it('is registered on a schedule, or it is just a function again', () => {
    // The defect this closes was precisely a function with no caller. A pass
    // that exists and is never run would be the same defect wearing the fix.
    const job = JOB_REGISTRY.institutional_effect_reconciliation;
    expect(job).toBeTruthy();
    expect(job.schedule).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    expect(job.description.length).toBeGreaterThan(30);
  });
});
