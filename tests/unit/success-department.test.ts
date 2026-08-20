// =============================================================================
// Tests: Customer Success — the first department (Hands Law layer 3)
// The trust ladder governs everything: shadow records, suggest queues for the
// founder, act sends. Envelopes and per-customer budgets bound the blast
// radius. Drafts are deterministic from real account state — no fabrication.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runSuccessSweep, draftCheckIn, CATEGORY } from '../../src/services/departments/success.js';
import { setPolicy } from '../../src/services/autopilot/policy.js';
import { setCap } from '../../src/services/outbound/envelopes.js';

const seedCustomer = (id: string, risk: number, extra: Record<string, unknown> = {}) => query(
  `INSERT INTO customers (id, product_id, owner_id, name, email, churn_risk, last_active_at)
   VALUES (?, 'cs_p', 'cs_f', ?, ?, ?, ?)`,
  [id, (extra.name as string) ?? `Cust ${id}`, `${id}@cust.co`, risk,
   (extra.last_active_at as string) ?? new Date(Date.now() - 20 * 86_400_000).toISOString()],
);

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('cs_f','clk_cs','cs@t.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('cs_p','SavvyCo','cs_f','active')", []);
  await seedCustomer('cs_c1', 0.9);
  await seedCustomer('cs_c2', 0.8);
  await query(
    `INSERT INTO customers (id, product_id, owner_id, name, email, churn_risk)
     VALUES ('cs_c3', 'cs_p', 'cs_f', 'Happy', 'happy@cust.co', 0.1)`, [],
  ); // healthy — never touched
});

describe('the trust ladder governs the department', () => {
  it('shadow (default): records what it WOULD do; sends nothing; dial appears in Controls', async () => {
    const res = await runSuccessSweep('cs_p');
    expect(res.atRisk).toBe(2);
    expect(res.shadowed).toBe(2);
    expect(res.proposed + res.sent).toBe(0);

    const execs = await query("SELECT * FROM action_executions WHERE product_id='cs_p'", []);
    expect(execs.rows.length).toBe(0); // nothing queued, nothing sent

    const audit = await query(
      "SELECT * FROM audit_log WHERE product_id='cs_p' AND action_type='dept:customer_success'", [],
    );
    expect(audit.rows.length).toBe(2); // the record that earns 'suggest'

    const policy = await query(
      `SELECT mode, set_by FROM autopilot_policies WHERE product_id='cs_p' AND category='${CATEGORY}'`, [],
    );
    expect((policy.rows[0] as Record<string, string>).mode).toBe('shadow'); // visible, founder-changeable
  });

  it('suggest: drafts land in the approval queue, grounded in real account state', async () => {
    await setPolicy('cs_p', CATEGORY, 'suggest', 'cs_f');
    const res = await runSuccessSweep('cs_p');
    expect(res.proposed).toBe(2);
    expect(res.sent).toBe(0);

    const execs = (await query(
      "SELECT payload_json, status FROM action_executions WHERE product_id='cs_p'", [],
    )).rows as unknown as Array<Record<string, string>>;
    expect(execs.length).toBe(2);
    expect(execs.every((e) => e.status === 'pending')).toBe(true); // founder approves
    const payload = JSON.parse(execs[0].payload_json);
    expect(payload.subject).toContain('SavvyCo');
    expect(payload.body).toMatch(/It's been about \d+ days/); // real last_active_at, not invented
  });

  it('dedup: a contacted customer is not re-drafted within 14 days', async () => {
    const res = await runSuccessSweep('cs_p');
    expect(res.proposed).toBe(0);
    expect(res.skipped).toBe(2);
  });

  it('act: the founder may grant it, and the platform cap still holds it', async () => {
    // THIS USED TO ASSERT THAT IT SENT. `customer_success` was absent from the
    // platform cap table, so it defaulted to 'act': a per-person churn score
    // assigned by a model, with no confidence and no evidence reference,
    // selected which NAMED CUSTOMERS got an email, daily, with nobody in the
    // loop. Outreach was capped at 'suggest' for reaching third parties; this
    // reaches the same third parties by the same post, and the asymmetry was
    // an omission rather than a decision.
    //
    // So the founder's setting is honoured as far as the ceiling allows and no
    // further: the work is proposed, and a person decides it goes.
    await seedCustomer('cs_c4', 0.95);
    await setPolicy('cs_p', CATEGORY, 'act', 'cs_f');
    const res = await runSuccessSweep('cs_p');
    expect(res.sent, 'the platform ceiling is not a founder setting').toBe(0);
    expect(res.proposed).toBe(1);

    const exec = (await query(
      `SELECT status, approved_by FROM action_executions
       WHERE product_id='cs_p' AND payload_json LIKE '%cs_c4%'`, [],
    )).rows[0] as Record<string, string>;
    expect(exec.status).toBe('pending');
    expect(exec.approved_by, 'nothing approved it, and nothing pretends to have')
      .toBeFalsy();
  });

  it('is held by the cap rather than by the ladder, and says which', async () => {
    const { effectiveMode, isCappedBelow, platformCap } = await import(
      '../../src/services/autopilot/platform-cap.js');
    expect(platformCap(CATEGORY)).toBe('suggest');
    expect(effectiveMode('act', CATEGORY)).toBe('suggest');
    expect(isCappedBelow('act', CATEGORY), 'Controls can say so honestly').toBe(true);
  });

  it('the department envelope is a hard weekly wall', async () => {
    await setCap('cs_p', 'dept:customer_success', 0); // founder slams it shut
    await seedCustomer('cs_c5', 0.85);
    const res = await runSuccessSweep('cs_p');
    expect(res.sent + res.proposed).toBe(0);
    expect(res.skipped).toBeGreaterThan(0); // wanted to act; the envelope said no
  });
});

describe('the draft cannot lie', () => {
  it('says only what the ledger holds', () => {
    const d = draftCheckIn(
      { name: 'Ada', last_active_at: new Date(Date.now() - 10 * 86_400_000).toISOString() },
      'SavvyCo',
    );
    expect(d.body).toContain('Ada');
    expect(d.body).toContain('about 10 days');
    const noHistory = draftCheckIn({ name: 'New' }, 'SavvyCo');
    expect(noHistory.body).not.toContain('days since'); // no data → no claim
  });
});
