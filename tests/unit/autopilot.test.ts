// =============================================================================
// Tests: The Autopilot (Ascent B6 realized / Trust Law)
//
// The full ladder, lived: shadow measurement → earned promotion (with quality
// hold) → founder-granted 'act' → guarded auto-action → anomaly demotion →
// undo-as-trust-signal → panic stop. Against the real migrated schema.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getPolicy, setPolicy, getAllPolicies, getShadowStats, processOutcomeFeedback,
  recordAnomaly, runAutopilotTick, undoAutopilotAction, panicStop,
  PROMOTION_THRESHOLD,
} from '../../src/services/autopilot/policy.js';

let seq = 0;
async function seedDecision(pid: string, opts: {
  category?: string; gate?: number; status?: string; decidedBy?: string;
  recommendation?: string; chosen?: string; valence?: number; hoursOld?: number;
}): Promise<string> {
  const id = `ap_d${++seq}`;
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status,
       decided_by, recommendation, chosen_option, outcome_valence, created_at, decided_at)
     VALUES (?, ?, ?, ?, 'x', 'y', ?, ?, ?, ?, ?,
       datetime('now', '-${opts.hoursOld ?? 24} hours'),
       CASE WHEN ? IS NOT NULL THEN datetime('now', '-1 hour') ELSE NULL END)`,
    [id, pid, opts.category ?? 'marketing', opts.gate ?? 1, opts.status ?? 'pending',
     opts.decidedBy ?? null, opts.recommendation ?? null, opts.chosen ?? null,
     opts.valence ?? null, opts.decidedBy ?? null],
  );
  return id;
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  for (const p of ['ap_main', 'ap_hold', 'ap_panic']) {
    await query(`INSERT INTO products (id, name, owner_id, scp_status) VALUES ('${p}','Co','o1','active')`, []);
  }
});

describe('shadow — trust measured at zero risk', () => {
  it('agreement is computed from recommendation vs the founder\'s actual choice', async () => {
    for (let i = 0; i < 6; i++) {
      await seedDecision('ap_main', {
        status: 'approved', decidedBy: 'founder',
        recommendation: 'Ship it', chosen: i < 5 ? 'Ship it' : 'Hold off',
      });
    }
    const stats = await getShadowStats('ap_main');
    const mkt = stats.find((s) => s.category === 'marketing')!;
    expect(mkt.sampled).toBe(6);
    expect(mkt.agreementRate).toBeCloseTo(5 / 6);
  });

  it('every category starts at shadow, visible in the policy list', async () => {
    expect((await getPolicy('ap_main', 'marketing')).mode).toBe('shadow');
    const all = await getAllPolicies('ap_main');
    expect(all.find((p) => p.category === 'marketing')?.mode).toBe('shadow');
  });
});

describe('earned promotion — clean cycles from real outcomes', () => {
  it('promotes shadow→suggest at the threshold, marked as earned', async () => {
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await seedDecision('ap_main', {
        status: 'approved', decidedBy: 'founder',
        recommendation: 'r', chosen: 'r', valence: 1,
      });
    }
    const fb = await processOutcomeFeedback('ap_main');
    expect(fb.cleanCycles).toBeGreaterThanOrEqual(PROMOTION_THRESHOLD);
    const p = await getPolicy('ap_main', 'marketing');
    expect(p.mode).toBe('suggest');
    expect(p.set_by).toBe('earned');
  });

  it('holds promotion when measured decision quality is below the floor', async () => {
    // 10 clean cycles but a majority-negative history → quality hold.
    for (let i = 0; i < PROMOTION_THRESHOLD; i++) {
      await seedDecision('ap_hold', {
        category: 'product', status: 'approved', decidedBy: 'founder',
        recommendation: 'r', chosen: 'r', valence: i < 3 ? 1 : -1,
      });
    }
    await processOutcomeFeedback('ap_hold');
    expect((await getPolicy('ap_hold', 'product')).mode).toBe('shadow'); // held
  });
});

describe('the act path — consent, guardrails, undo', () => {
  it('acts only in founder-granted categories, gate ≤ 1, past the grace window', async () => {
    await setPolicy('ap_main', 'marketing', 'act', 'founder_1'); // explicit consent
    const eligible = await seedDecision('ap_main', { gate: 1, recommendation: 'Send the campaign', hoursOld: 24 });
    const highStakes = await seedDecision('ap_main', { gate: 3, recommendation: 'Bet the company', hoursOld: 24 });
    const tooFresh = await seedDecision('ap_main', { gate: 1, recommendation: 'New idea', hoursOld: 1 });
    const otherCat = await seedDecision('ap_main', { category: 'product', gate: 1, recommendation: 'r', hoursOld: 24 });

    const result = await runAutopilotTick('ap_main');
    expect(result.decisions.map((d) => d.id)).toEqual([eligible]);

    const acted = await query('SELECT status, decided_by, chosen_option FROM decisions WHERE id = ?', [eligible]);
    const row = acted.rows[0] as Record<string, unknown>;
    expect(row.status).toBe('approved');
    expect(row.decided_by).toBe('second_self');
    expect(row.chosen_option).toBe('Send the campaign');
    for (const id of [highStakes, tooFresh, otherCat]) {
      const r = await query('SELECT status FROM decisions WHERE id = ?', [id]);
      expect((r.rows[0] as Record<string, unknown>).status).toBe('pending');
    }
  });

  it('a paused company means a paused autopilot (kill switch)', async () => {
    await query("UPDATE products SET scp_status = 'paused' WHERE id = 'ap_main'", []);
    await seedDecision('ap_main', { gate: 1, recommendation: 'r', hoursOld: 24 });
    expect((await runAutopilotTick('ap_main')).acted).toBe(0);
    await query("UPDATE products SET scp_status = 'active' WHERE id = 'ap_main'", []);
  });

  it('undo restores the decision AND demotes the category (undo is a trust signal)', async () => {
    const tick = await runAutopilotTick('ap_main'); // acts on the decision seeded above
    expect(tick.acted).toBe(1);
    const undone = await undoAutopilotAction(tick.decisions[0].id, 'ap_main');
    expect(undone).toBe(true);
    const d = await query('SELECT status, decided_by FROM decisions WHERE id = ?', [tick.decisions[0].id]);
    expect((d.rows[0] as Record<string, unknown>).status).toBe('pending');
    const p = await getPolicy('ap_main', 'marketing');
    expect(p.mode).toBe('suggest'); // pulled back from act
    expect(p.set_by).toBe('undo_demotion');
  });

  it('a negative autopilot outcome is an anomaly: instant one-rung demotion', async () => {
    await setPolicy('ap_main', 'marketing', 'act', 'founder_1');
    await seedDecision('ap_main', {
      status: 'approved', decidedBy: 'second_self',
      recommendation: 'r', chosen: 'r', valence: -1,
    });
    const fb = await processOutcomeFeedback('ap_main');
    expect(fb.anomalies).toBe(1);
    const p = await getPolicy('ap_main', 'marketing');
    expect(p.mode).toBe('suggest');
  });

  it('recordAnomaly floors at shadow and stamps the reason', async () => {
    await recordAnomaly('ap_main', 'marketing', 'test breaker');
    await recordAnomaly('ap_main', 'marketing', 'test breaker again');
    const all = await getAllPolicies('ap_main');
    const mkt = all.find((p) => p.category === 'marketing')!;
    expect(mkt.mode).toBe('shadow');
    expect(mkt.last_demotion_reason).toBe('test breaker again');
  });
});

describe('panic stop', () => {
  it('returns every category to shadow while keeping the records', async () => {
    await setPolicy('ap_panic', 'marketing', 'act', 'founder_1');
    await setPolicy('ap_panic', 'product', 'suggest', 'founder_1');
    const stopped = await panicStop('ap_panic', 'founder_1');
    expect(stopped).toBe(2);
    for (const cat of ['marketing', 'product']) {
      expect((await getPolicy('ap_panic', cat)).mode).toBe('shadow');
    }
  });
});
