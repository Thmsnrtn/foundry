// =============================================================================
// Tests: Marketing, Product Evolution, Outreach (Hands Law H3–H5)
// Each department is the same loop on the same governance. Marketing's
// campaigns carry graced premises that falsify honestly. Product hypotheses
// are gate-3 (auto-contested) and must cite the thesis. Outreach never
// auto-sends and the suppression list beats every mode.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runMarketingSweep, draftContentBrief } from '../../src/services/departments/marketing.js';
import { runProductSweep, deriveHypothesis } from '../../src/services/departments/product.js';
import { runOutreachSweep, addSuppression } from '../../src/services/departments/outreach.js';
import { setPolicy } from '../../src/services/autopilot/policy.js';
import { checkPremises } from '../../src/services/memory/kernel.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('dp_f','clk_dp','dp@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('dp_p','GrowCo','dp_f','active')", []);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, activation_rate, churn_rate)
     VALUES ('dp_s1', 'dp_p', date('now'), 10, 0.3, 0.03)`,
    [],
  );
});

describe('marketing: campaigns that kill their own bad bets', () => {
  it('shadow by default; proposing requires the ladder', async () => {
    const res = await runMarketingSweep('dp_p');
    expect(res.sensed).toBe(true);
    expect(res.shadowed).toBe(1);
    expect(res.proposed).toBe(0);
  });

  it('at suggest: the campaign is a decision with a GRACED signups premise', async () => {
    await setPolicy('dp_p', 'marketing', 'suggest', 'dp_f');
    const res = await runMarketingSweep('dp_p');
    expect(res.proposed).toBe(1);

    const d = (await query(
      "SELECT id, gate, status FROM decisions WHERE product_id='dp_p' AND category='marketing'", [],
    )).rows[0] as Record<string, unknown>;
    expect(d.gate).toBe(2); // the founder commits campaigns personally
    expect(d.status).toBe('pending');

    const p = (await query(
      `SELECT metric_key, threshold, effective_at FROM decision_premises WHERE decision_id = ?`, [String(d.id)],
    )).rows[0] as Record<string, unknown>;
    expect(p.metric_key).toBe('signups_7d');
    expect(Number(p.threshold)).toBe(12); // ceil(10 * 1.2)
    expect(p.effective_at).toBeTruthy(); // judged after the window, not before

    // The grace window holds: today's check must NOT falsify tomorrow's bet.
    const check = await checkPremises('dp_p');
    const still = (await query(
      `SELECT status FROM decision_premises WHERE decision_id = ?`, [String(d.id)],
    )).rows[0] as Record<string, string>;
    expect(still.status).toBe('holding');
    expect(check.falsified).toBe(0);
  });

  it('one campaign per cycle — founder attention is the scarce resource', async () => {
    const res = await runMarketingSweep('dp_p');
    expect(res.proposed).toBe(0);
    expect(res.reason).toContain('already');
  });

  it('the brief never invents positioning', () => {
    const sparse = draftContentBrief(null);
    expect(sparse.grounded).toBe(false);
    expect(sparse.brief).toContain('DNA is thin');
    const rich = draftContentBrief({
      icp_description: 'solo SaaS founders', icp_pain: 'drowning in ops',
      positioning_statement: 'the team you cannot afford to hire',
    });
    expect(rich.grounded).toBe(true);
    expect(rich.brief).toContain('solo SaaS founders');
  });
});

describe('product evolution: hypotheses cite the thesis and face the Red Team', () => {
  it('no thesis → no invented feature ideas', async () => {
    await setPolicy('dp_p', 'product_evolution', 'suggest', 'dp_f');
    const res = await runProductSweep('dp_p');
    expect(res.proposed).toBe(0);
    expect(res.reason).toContain('no product thesis');
  });

  it('with a thesis: a gate-3 decision citing it, premised and graced', async () => {
    await query(
      `INSERT INTO product_dna (id, product_id, positioning_statement, what_we_are_not, sections_completed, completion_pct)
       VALUES ('dp_dna', 'dp_p', 'The tireless team for solo founders', 'not an analytics dashboard', '[]', 40)`,
      [],
    );
    const res = await runProductSweep('dp_p');
    expect(res.proposed).toBe(1);

    const d = (await query(
      "SELECT gate, what, recommendation FROM decisions WHERE product_id='dp_p' AND category='product' AND recommendation LIKE 'Serves the thesis:%'", [],
    )).rows[0] as Record<string, unknown>;
    expect(d.gate).toBe(3); // the existing red_team_sweep will contest this
    expect(String(d.what)).toContain('first-run'); // activation 0.3 is the strongest signal
    expect(String(d.recommendation)).toContain('The tireless team'); // cites the thesis
    expect(String(d.recommendation)).toContain('not an analytics dashboard');
  });

  it('derivation is honest: no crossed line, no hypothesis', () => {
    expect(deriveHypothesis({ activation_rate: 0.8, churn_rate: 0.02, support_volume_7d: 3 })).toBeNull();
    expect(deriveHypothesis({ churn_rate: 0.12 })?.metricKey).toBe('churn_rate');
  });
});

describe('the loop closes', () => {
  it('a committed hypothesis becomes tracked work carrying its bet', async () => {
    const { onHypothesisResolved } = await import('../../src/services/departments/product.js');
    const d = (await query(
      "SELECT id FROM decisions WHERE product_id='dp_p' AND recommendation LIKE 'Serves the thesis:%'", [],
    )).rows[0] as Record<string, string>;

    await onHypothesisResolved(d.id, 'dp_p', 'Do nothing for now');
    let tickets = await query(
      "SELECT * FROM action_executions WHERE product_id='dp_p' AND action_type='create_ticket'", [],
    );
    expect(tickets.rows.length).toBe(0); // declined → no work

    await onHypothesisResolved(d.id, 'dp_p', 'Proceed — rework onboarding');
    tickets = await query(
      "SELECT payload_json, status FROM action_executions WHERE product_id='dp_p' AND action_type='create_ticket'", [],
    );
    expect(tickets.rows.length).toBe(1);
    const payload = JSON.parse((tickets.rows[0] as Record<string, string>).payload_json);
    expect(payload.ticket_title).toContain('first-run');
    expect(payload.ticket_description).toContain('The bet on record'); // premise travels with the work
  });

  it("the Letter tells the founder what a watching department WOULD have done", async () => {
    const { composeLetter } = await import('../../src/services/letter/composer.js');
    const letter = await composeLetter('dp_p', 'plain');
    expect(letter.trust.some((t) => t.includes('marketing department is still just watching'))).toBe(true);
  });
});

describe('outreach: the slowest ladder, the hardest rails', () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, email, health_score, is_champion)
       VALUES ('or_c1', 'dp_p', 'dp_f', 'Ada', 'ada@fan.co', 0.95, 1),
              ('or_c2', 'dp_p', 'dp_f', 'Sup', 'sup@fan.co', 0.9, 1)`,
      [],
    );
  });

  it('even at act, nothing auto-sends — every ask waits for the founder', async () => {
    await setPolicy('dp_p', 'outreach', 'act', 'dp_f');
    const res = await runOutreachSweep('dp_p');
    expect(res.proposed).toBe(2);

    const execs = (await query(
      "SELECT status FROM action_executions WHERE product_id='dp_p' AND payload_json LIKE '%outreach_customer%'", [],
    )).rows as unknown as Array<Record<string, string>>;
    expect(execs.length).toBe(2);
    expect(execs.every((e) => e.status === 'pending')).toBe(true); // rail 2 holds
  });

  it('the suppression list beats every mode', async () => {
    await addSuppression('dp_p', 'ADA@fan.co', 'unsubscribed'); // case-insensitive
    await query("DELETE FROM action_executions WHERE product_id='dp_p'", []); // clear dedup
    const res = await runOutreachSweep('dp_p');
    expect(res.suppressed).toBe(1);
    const asks = await query(
      "SELECT payload_json FROM action_executions WHERE product_id='dp_p'", [],
    );
    expect(JSON.stringify(asks.rows)).not.toContain('ada@fan.co');
  });
});
