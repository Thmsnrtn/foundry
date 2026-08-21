process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getChurnIntelligence } from '../../src/services/founder/intelligence.js';

// =============================================================================
// TWENTY OF FIFTY, PRINTED AS FIFTY'S TOTAL.
//
// `getChurnIntelligence` read the at-risk companies with `LIMIT 20` — a sane
// cap for a table on a page — and then derived every NUMBER from the length of
// that list. `at_risk_count` was `atRisk.rows.length`. So was the numerator of
// the rate, whose denominator was the uncapped count of active companies. So
// was `rescue_opportunities`.
//
// The headline card on the operator's page therefore read "At Risk: 20" for
// any portfolio with twenty or more at-risk companies, and the rate it sat
// beside fell as the real problem grew. The cap that existed so a table would
// fit had become the measurement.
//
// Two more claims in the same shape:
//
// `churn_rate_30d` had no 30-day window — nothing in the query looks at time —
// and was computed from companies that are still active, which is to say from
// companies that have not churned. It is renamed to what it measures.
//
// `churned_this_month: 0` said nobody left. Nothing records when a company
// churns: `deprovisionSCP` moves `scp_status` and touches `updated_at`, which
// every other write also touches, and the other archive path is ERASURE — a
// person exercising a deletion right, which is not a customer leaving. Null.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM lifecycle_state');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function owner(): Promise<string> {
  await query(
    `INSERT INTO founders (id, clerk_user_id, email) VALUES ('own1','clerk_own1','own1@example.com')`);
  return 'own1';
}

let seq = 0;
async function addCompany(risk: 'green' | 'yellow' | 'red'): Promise<void> {
  const id = `p_${++seq}`;
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')`,
    [id, `Company ${seq}`, 'own1']);
  await query(
    `INSERT INTO lifecycle_state (product_id, risk_state) VALUES (?,?)`, [id, risk]);
}

describe('the count and the table are different things', () => {
  it('counts every at-risk company, past the twenty the page shows', async () => {
    await owner();
    for (let i = 0; i < 30; i++) await addCompany('red');
    for (let i = 0; i < 20; i++) await addCompany('yellow');

    const churn = await getChurnIntelligence();
    expect(churn.at_risk_count, 'fifty are at risk').toBe(50);
    expect(churn.at_risk_products.length, 'twenty fit on the page').toBe(20);
    expect(churn.at_risk_count).not.toBe(churn.at_risk_products.length);
  });

  it('counts rescuable companies over all of them, not over the page', async () => {
    await owner();
    for (let i = 0; i < 25; i++) await addCompany('red');
    for (let i = 0; i < 25; i++) await addCompany('yellow');

    const churn = await getChurnIntelligence();
    expect(churn.rescue_opportunities, 'twenty-five yellow').toBe(25);
  });

  it('does not divide a capped numerator by an uncapped denominator', async () => {
    await owner();
    for (let i = 0; i < 40; i++) await addCompany('red');
    for (let i = 0; i < 60; i++) await addCompany('green');

    const churn = await getChurnIntelligence();
    expect(churn.at_risk_share_pct, '40 of 100').toBe(40);
    expect(churn.at_risk_share_pct, 'the capped answer would have been 20').not.toBe(20);
  });

  it('derives no number from the length of the limited list', () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    const fn = src.slice(src.indexOf('export async function getChurnIntelligence'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
    expect(body, 'a page limit is not a measurement').not.toMatch(/atRisk\.rows\.length/);
    expect(body).not.toMatch(/atRisk\.rows\.filter/);
  });
});

describe('a share of the at-risk is not a churn rate', () => {
  it('is named for what it measures', async () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'no 30-day window exists in that query').not.toMatch(/churn_rate_30d/);
  });

  it('says unknown rather than zero when there are no companies', async () => {
    const churn = await getChurnIntelligence();
    expect(churn.at_risk_share_pct, 'nothing to divide').toBeNull();
    expect(churn.at_risk_count).toBe(0);
  });

  it('ignores companies that are no longer active', async () => {
    await owner();
    await addCompany('red');
    await query("UPDATE products SET status = 'archived'");
    const churn = await getChurnIntelligence();
    expect(churn.at_risk_count).toBe(0);
    expect(churn.at_risk_share_pct, 'no active companies to be a share of').toBeNull();
  });
});

describe('churn itself', () => {
  it('is unmeasured, not zero', async () => {
    await owner();
    await addCompany('red');
    const churn = await getChurnIntelligence();
    expect(churn.churned_this_month, 'nothing records when a company leaves').toBeNull();
  });

  it('is not inferred from an archived row, because erasure archives too', async () => {
    await owner();
    await addCompany('green');
    await query("UPDATE products SET status = 'archived', scp_status = 'archived'");
    const churn = await getChurnIntelligence();
    expect(churn.churned_this_month,
      'a person exercising a deletion right is not a customer leaving').toBeNull();
  });
});

describe('the page the operator reads', () => {
  it('says the table is capped when it is', () => {
    const src = readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8');
    expect(src).toMatch(/this table is capped, the count above is not/);
    expect(src).toMatch(/churn\.at_risk_count > churn\.at_risk_products\.length/);
  });
});
