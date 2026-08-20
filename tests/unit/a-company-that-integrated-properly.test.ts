process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  AT_RISK_CHURN_RISK, AT_RISK_HEALTH_SCORE, customerStoreSplit, getCustomerHealth,
  getCompanyCustomers, getCustomersAtRisk,
} from '../../src/services/institution/company-customers.js';
import { draftCheckIn, runSuccessSweep, CATEGORY } from '../../src/services/departments/success.js';
import { getChampions, CHAMPION_MIN_HEALTH } from '../../src/services/institution/company-customers.js';
import { setPolicy } from '../../src/services/autopilot/policy.js';

// =============================================================================
// REALITY ARRIVED IN THE TABLE NOBODY READ.
//
// `customers` and `customer_intelligence` both hold a company's customers, and
// the split runs exactly along the line between where a real company's data
// ENTERS and where the institution LOOKS:
//
//   `POST /api/v1/customers` — the documented external surface, with issued
//   scoped credentials, the path a real company integrates against — writes
//   `customer_intelligence`.
//
//   The customer success department read `customers`, whose only writers are a
//   session-authenticated route no client calls and the demo seed.
//
// So a company that reported its customers the documented way was invisible to
// the department that acts on customers. The capability is real — governed,
// platform-capped, consent-gated, budgeted, verified, tested — and structurally
// starved for exactly the companies that integrated properly. Nothing was
// broken; the two halves had simply never been introduced.
//
// AND THE TWO "AT RISK" DEFINITIONS WERE ONE. `churn_risk > 0.6` and
// `health_score < 40` are the same line, because `computeCustomerHealth`
// defines churn risk as `(100 - health)/100`. Nothing is invented by
// normalising; the derivation is the codebase's own.
// =============================================================================

const P = 'cip_product';
const OWNER = 'cip_owner';

const reported = (id: string, email: string, health: number, lastActive?: string) => query(
  `INSERT INTO customer_intelligence
     (id, product_id, external_customer_id, account_name, email, health_score, last_active_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
  [id, P, `ext_${id}`, `Acct ${id}`, email, health, lastActive ?? null],
);

const legacy = (id: string, email: string, churn: number) => query(
  `INSERT INTO customers (id, product_id, owner_id, external_id, name, email, churn_risk, health_score, last_active_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, P, OWNER, `ext_${id}`, `Legacy ${id}`, email, churn,
    Math.round((1 - churn) * 100), new Date(Date.now() - 20 * 86_400_000).toISOString()],
);

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'cip_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Integrated Co',?,'active')`, [P, OWNER]);
});

beforeEach(async () => {
  await query('DELETE FROM customer_intelligence');
  await query('DELETE FROM customers');
  await query('DELETE FROM action_executions');
  await query('DELETE FROM audit_log');
});

describe('a customer reported through the documented API', () => {
  it('is a customer the institution can see', async () => {
    await reported('r1', 'ada@buyer.example', 20);
    const all = await getCompanyCustomers(P);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ source: 'reported', email: 'ada@buyer.example' });
  });

  it('is at risk on the same line the other store used', async () => {
    // health 20 → churn 0.80, over the threshold. health 70 → churn 0.30, under.
    await reported('r_bad', 'bad@buyer.example', 20);
    await reported('r_ok', 'ok@buyer.example', 70);

    const atRisk = await getCustomersAtRisk(P);
    expect(atRisk.map((c) => c.email)).toEqual(['bad@buyer.example']);
    expect(atRisk[0].churnRisk).toBeCloseTo(0.8);
  });

  it('reaches the department that acts on customers', async () => {
    // THE DEFECT, END TO END. Before this, the sweep saw nothing for a company
    // whose customers all arrived the documented way.
    await reported('r1', 'ada@buyer.example', 15, new Date(Date.now() - 20 * 86_400_000).toISOString());
    await setPolicy(P, CATEGORY, 'shadow', OWNER);

    const res = await runSuccessSweep(P);
    expect(res.atRisk, 'the company is not empty to the department').toBe(1);
    expect(res.shadowed).toBe(1);
  });

  it('is personalised, rather than losing the sentence to a column name', async () => {
    // `draftCheckIn` read `last_active_at` — the LEGACY column name. A reported
    // customer produced the generic sentence because the property was simply
    // absent, which is how a store migration goes quiet instead of failing.
    const days20 = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(draftCheckIn({ name: 'Ada', lastActiveAt: days20 }, 'Northwind').body)
      .toMatch(/It's been about \d+ days/);
    // The legacy spelling still works, for fixtures that predate the accessor.
    expect(draftCheckIn({ name: 'Ada', last_active_at: days20 }, 'Northwind').body)
      .toMatch(/It's been about \d+ days/);
  });
});

describe('the two stores, while both exist', () => {
  it('are one list, and every record says which it came from', async () => {
    await reported('r1', 'ada@buyer.example', 20);
    await legacy('l1', 'bob@buyer.example', 0.9);

    const all = await getCompanyCustomers(P);
    expect(all).toHaveLength(2);
    expect(all.map((c) => c.source).sort()).toEqual(['legacy', 'reported']);
  });

  it('do not double-count one person who is in both', async () => {
    await legacy('l1', 'Ada@Buyer.Example', 0.9);
    await reported('r1', 'ada@buyer.example', 20);

    const all = await getCompanyCustomers(P);
    expect(all, 'one person, matched across the case difference').toHaveLength(1);
    expect(all[0].source, 'the credentialled surface is the more recent statement')
      .toBe('reported');
  });

  it('measure how far apart they are, so the cutover has a criterion', async () => {
    await reported('r1', 'ada@buyer.example', 20);
    await legacy('l1', 'bob@buyer.example', 0.9);
    await legacy('l2', 'ada@buyer.example', 0.5);   // same person as r1

    const split = await customerStoreSplit(P);
    expect(split.total).toBe(2);
    expect(split.reported).toBe(1);
    expect(split.onlyLegacy, 'what has to reach zero before the legacy read goes')
      .toBe(1);
  });

  it('belong to their own company', async () => {
    await reported('r1', 'ada@buyer.example', 20);
    await legacy('l1', 'bob@buyer.example', 0.9);
    expect(await getCompanyCustomers('some_other_product')).toEqual([]);
  });
});

describe('a customer whose risk nobody has established', () => {
  it('is not at risk, because unknown is not a finding', async () => {
    await query(
      `INSERT INTO customer_intelligence (id, product_id, external_customer_id, email, health_score)
       VALUES ('r_null', ?, 'ext_null', 'quiet@buyer.example', NULL)`, [P]);

    expect(await getCompanyCustomers(P)).toHaveLength(1);
    expect(await getCustomersAtRisk(P),
      'a missing score is not a reason to write to somebody').toEqual([]);
  });
});

describe('the threshold', () => {
  it('is one line stated in both units', () => {
    // `> 0.6` and `< 40` were the same predicate written twice. Kept beside
    // each other so a future change moves one number, not two.
    expect(AT_RISK_HEALTH_SCORE).toBeCloseTo((1 - AT_RISK_CHURN_RISK) * 100);
    expect(AT_RISK_HEALTH_SCORE).toBeCloseTo(40);
  });
});

describe('verifying what happened to a customer afterwards', () => {
  it('finds their health in whichever store holds them', async () => {
    await reported('r1', 'ada@buyer.example', 15);
    await legacy('l1', 'bob@buyer.example', 0.9);

    expect(await getCustomerHealth(P, 'r1'), 'the reported store').toBe(15);
    expect(await getCustomerHealth(P, 'l1'), 'the legacy store').toBe(10);
  });

  it('abstains because there is no basis, not because it looked in one table', async () => {
    await reported('r1', 'ada@buyer.example', 15);
    expect(await getCustomerHealth(P, 'nobody'), 'a customer that does not exist').toBeNull();
    expect(await getCustomerHealth('some_other_product', 'r1'),
      'and never another company\'s customer').toBeNull();
  });

  it('is what the verifier asks, so a reported customer is not a vacuous pass', async () => {
    // The criterion returns null (abstain) when health cannot be established.
    // Before the accessor, a reported customer ALWAYS produced that — the
    // outcome loop stopped silently for exactly the customers the department
    // had just gained.
    const { verifyDueActions } = await import('../../src/services/outbound/action-verifier.js');
    await reported('r1', 'ada@buyer.example', 10);   // fell from a baseline of 80
    await query(
      `INSERT INTO action_executions (id, product_id, action_type, integration, payload_json, status, verify_criteria, verify_status, verify_after)
       VALUES ('cip_exec', ?, 'send_email', 'resend', '{}', 'completed', ?, 'pending', datetime('now','-1 hour'))`,
      [P, JSON.stringify([{ kind: 'customer_health_not_worse', customer_id: 'r1', baseline_health: 80 }])]);

    await verifyDueActions();
    const row = (await query(
      'SELECT verify_status FROM action_executions WHERE id = ?', ['cip_exec'],
    )).rows[0] as Record<string, unknown>;
    expect(row.verify_status, 'health fell far below the baseline and the check saw it')
      .toBe('failed');
  });
});

describe('the other department that acts on customers', () => {
  it('sees a reported champion, which a stored flag could never mark', async () => {
    // `customers.is_champion` is set by the daily health refresh, and only for
    // rows in that store. Outreach read the flag, so every customer a company
    // reported the documented way was excluded from the referral sweep.
    await reported('r_champ', 'champ@buyer.example', 95);
    const champs = await getChampions(P);
    expect(champs.map((c) => c.email)).toEqual(['champ@buyer.example']);
    expect(champs[0].source).toBe('reported');
  });

  it('does not ask a healthy customer whose risk is climbing', async () => {
    // Both halves of the definition matter, and deriving them means there is no
    // stale flag saying otherwise.
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, email, health_score, churn_risk, is_champion)
       VALUES ('l_stale', ?, ?, 'Stale', 'stale@buyer.example', 95, 0.9, 1)`, [P, OWNER]);
    expect(await getChampions(P),
      'the stored flag said champion and the numbers say otherwise').toEqual([]);
  });

  it('holds the line at the health the marking job uses', async () => {
    await reported('r_mid', 'mid@buyer.example', CHAMPION_MIN_HEALTH);
    expect(await getChampions(P), 'the threshold is exclusive, as the job\'s is').toEqual([]);
  });
});

describe('a department asks the institution, not a table', () => {
  // THE RATCHET THAT KEEPS THIS CLOSED. The defect was not that the wrong table
  // was chosen — it was that each subsystem chose one. A department that names
  // a customer table in SQL has picked a store, which is the decision this
  // accessor exists to hold in one place.
  const files = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

  it('names no customer table under departments/ or institution/', () => {
    const offenders: string[] = [];
    for (const file of [...files('src/services/departments'), ...files('src/services/institution')]) {
      if (file.endsWith('company-customers.ts')) continue;   // the accessor itself
      // Comments describe the defect and name both tables on purpose.
      const src = stripComments(readFileSync(file, 'utf8'), { lineComments: true });
      if (/\b(FROM|INTO|UPDATE|JOIN)\s+customers?\b|customer_intelligence/i.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders, 'a department that names a store has picked one').toEqual([]);
  });
});
