// =============================================================================
// FOUNDRY — Autonomy Convergence (behavioral simulation, not just "no crash")
//
// The wave sims prove the system doesn't 500 and holds tenant isolation. This
// grades something harder: does the autonomy machinery CONVERGE to the right
// behavior over simulated time? A trustworthy autopilot must:
//   - promote a category that earns it (good outcomes → clean cycles → suggest)
//   - refuse to promote a well-agreeing but OVERCONFIDENT category (calibration)
//   - demote instantly on a real-world failure (anomaly)
//   - never exceed the platform cap, whatever the trust history
// If any of these drift, autonomy is unsafe to grant — and this test says so.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  processOutcomeFeedback, getPolicy, setPolicy, PROMOTION_THRESHOLD,
} from '../../src/services/autopilot/policy.js';
import { getCategoryCalibration } from '../../src/services/autopilot/calibration.js';

let seq = 0;
/** Simulate one resolved decision in a category with a known outcome. */
async function resolvedDecision(productId: string, category: string, valence: 'positive' | 'negative', decidedBy = 'second_self') {
  const id = `cv_${++seq}`;
  // WHOSE JUDGEMENT WAS TESTED. A clean cycle banks toward Foundry's autonomy,
  // so it only counts when FOUNDRY's judgement was the one that got it right:
  // `decided_by = 'second_self'`, or a recommendation Foundry made that the
  // founder then chose. `decided_by = 'founder'` says who RESOLVED the row.
  // Without the recommendation, this fixture was ten decisions the founder made
  // themselves, and it used to earn Foundry a promotion.
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, outcome_valence, autopilot_counted, recommendation, chosen_option)
     VALUES (?, ?, ?, 1, 'sim', 'sim', 'executed', ?, ?, 0, 'Run it', 'run it')`,
    [id, productId, category, decidedBy, valence === 'positive' ? 1 : -1],
  );
  return id;
}

/**
 * Simulate a belief a category's decision rested on, resolved either way (for
 * calibration). This seeded verified autonomous actions until the legacy
 * executor and its verifier were deleted in Roadmap 2027 R10; calibration now
 * reads premises only, so the same verdicts are reached through them.
 */
async function resolvedPremise(productId: string, category: string, status: 'holding' | 'falsified') {
  const did = nanoid();
  // Pending, so the outcome loop does not count it as a resolved decision: it
  // carries the belief and nothing else.
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES (?, ?, ?, 2, 'sim', 'sim', 'pending')`, [did, productId, category],
  );
  await query(
    `INSERT INTO decision_premises (id, product_id, decision_id, decision_source, premise, premise_type, status, origin)
     VALUES (?, ?, ?, 'decision', 'p', 'metric', ?, 'founder')`,
    [nanoid(), productId, did, status],
  );
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('cv_p','ConvergeCo','cv_o','active')", []);
});

describe('the autopilot converges to the right behavior over time', () => {
  // Auto-promotion via processOutcomeFeedback is keyed to DECISION categories
  // (urgent/strategic/product/marketing/informational). Department names
  // (customer_success/outreach) earned trust via their verified-action record +
  // an explicit founder grant; the departments and the verifier were deleted
  // in Roadmap 2027 R10, so only the explicit grant and the cap remain.
  it('a category that consistently succeeds EARNS promotion (shadow → suggest)', async () => {
    await setPolicy('cv_p', 'marketing', 'shadow', 'sim');
    // Well-calibrated: its beliefs hold, its decisions land positive.
    for (let i = 0; i < 5; i++) await resolvedPremise('cv_p', 'marketing', 'holding');
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await resolvedDecision('cv_p', 'marketing', 'positive', 'founder');
    }
    await processOutcomeFeedback('cv_p');

    const policy = await getPolicy('cv_p', 'marketing');
    expect(policy.mode).toBe('suggest'); // earned it
    const cal = await getCategoryCalibration('cv_p', 'marketing');
    expect(cal.verdict).toBe('well_calibrated');
  });

  it('an OVERCONFIDENT category is held at shadow despite a clean agreement record', async () => {
    await setPolicy('cv_p', 'strategic', 'shadow', 'sim');
    // Agreement looks great (positive outcomes) — but its BELIEFS were falsified.
    for (let i = 0; i < 6; i++) await resolvedPremise('cv_p', 'strategic', 'falsified');
    for (let i = 0; i < PROMOTION_THRESHOLD + 2; i++) {
      await resolvedDecision('cv_p', 'strategic', 'positive', 'founder');
    }
    await processOutcomeFeedback('cv_p');

    const policy = await getPolicy('cv_p', 'strategic');
    expect(policy.mode).toBe('shadow'); // calibration hold — did NOT promote
    const cal = await getCategoryCalibration('cv_p', 'strategic');
    expect(cal.verdict).toBe('overconfident');
  });

  it('a real-world failure demotes an acting category instantly', async () => {
    await setPolicy('cv_p', 'product', 'act', 'sim');
    // A negative outcome on an autopilot (second_self) decision is an anomaly.
    await resolvedDecision('cv_p', 'product', 'negative', 'second_self');
    await processOutcomeFeedback('cv_p');

    const policy = await getPolicy('cv_p', 'product');
    expect(policy.mode).toBe('suggest'); // act → suggest, one rung down
    const row = (await query(
      "SELECT last_demotion_reason, clean_cycles FROM autopilot_policies WHERE product_id='cv_p' AND category='product'", [],
    )).rows[0] as Record<string, unknown>;
    expect(row.last_demotion_reason).toBeTruthy();
    expect(Number(row.clean_cycles)).toBe(0); // counter reset on demotion
  });

  it('the platform cap holds regardless of an earned trust history', async () => {
    // outreach caps at suggest; even a flawless record cannot reach act. (The
    // record was five verified actions, which nothing can produce since Roadmap
    // 2027 R10; `outreach` is not a decision category, so it has no premises
    // to stand in. The cap is what is asserted, and it never read the record.)
    await setPolicy('cv_p', 'outreach', 'suggest', 'sim');
    const { getEffectiveMode } = await import('../../src/services/autopilot/policy.js');
    // Even if the founder tries to grant act:
    await setPolicy('cv_p', 'outreach', 'act', 'sim');
    expect(await getEffectiveMode('cv_p', 'outreach')).toBe('suggest'); // capped, forever
  });

  it('convergence is monotone under repeated ticks — no oscillation from replay', async () => {
    // Re-running the feedback loop must not double-count (idempotent counting).
    const before = (await query(
      "SELECT clean_cycles FROM autopilot_policies WHERE product_id='cv_p' AND category='marketing'", [],
    )).rows[0] as Record<string, number>;
    await processOutcomeFeedback('cv_p'); // nothing new to count
    await processOutcomeFeedback('cv_p');
    const after = (await query(
      "SELECT clean_cycles FROM autopilot_policies WHERE product_id='cv_p' AND category='marketing'", [],
    )).rows[0] as Record<string, number>;
    expect(Number(after.clean_cycles)).toBe(Number(before.clean_cycles)); // stable
  });
});
