process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getAutomationHealth, getCustomerHealthOverview,
} from '../../src/services/founder/intelligence.js';

// =============================================================================
// A RATE OVER NOTHING, PRINTED AS THE BEST POSSIBLE RESULT.
//
// `auto_execute_rate` fell back to **100** when no decision had been made in
// the last day. The most reassuring number on the automation panel appeared
// precisely when there was nothing to report — "Auto-Execute Rate: 100%" is
// what an idle deployment showed, and what a broken one showed too.
//
// `avg_health_score` fell the other way, to **0**: the WORST possible score,
// printed for having scored nobody. Both are the same mistake — a quotient
// with an empty denominator answered with a number instead of "nothing to
// divide" — and it is worth seeing that the same mistake can look like good
// news or bad news depending on which way the fallback was typed.
//
// And an action row whose `outcome` column was never written rendered as
// 'completed'. An outcome nobody recorded is not a successful one.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM audit_log');
  await query('DELETE FROM decisions');
  await query('DELETE FROM customers');
  await query('DELETE FROM customer_intelligence');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

let lastOwner = '';
async function addCompany(): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  lastOwner = owner;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `clerk_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'Company', owner]);
  return pid;
}

describe('an automation rate with nothing to divide', () => {
  it('is unknown, not a hundred per cent', async () => {
    const a = await getAutomationHealth();
    expect(a.auto_decisions_24h).toBe(0);
    expect(a.escalated_decisions_24h).toBe(0);
    expect(a.auto_execute_rate, 'the idle deployment scored perfectly').toBeNull();
  });

  it('is a real rate once there are decisions', async () => {
    const pid = await addCompany();
    for (let i = 0; i < 3; i++) {
      await query(
        `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
         VALUES (?,?, 'auto_action', 0, 'test', 'test', datetime('now'))`, [nanoid(), pid]);
    }
    await query(
      `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, created_at)
       VALUES (?,?,'product',2,'x','y','pending', datetime('now'))`, [nanoid(), pid]);

    const a = await getAutomationHealth();
    expect(a.auto_execute_rate, '3 of 4').toBe(75);
  });

  it('does not report an unrecorded outcome as completed', async () => {
    const pid = await addCompany();
    await query(
      `INSERT INTO audit_log (id, product_id, action_type, gate, trigger, reasoning, created_at)
       VALUES (?,?, 'auto_action', 0, 'test', 'test', datetime('now'))`, [nanoid(), pid]);

    const a = await getAutomationHealth();
    expect(a.recent_actions[0].outcome, 'nobody wrote an outcome').toBe('not recorded');
  });

  it('looks the audit date up once, in the function that reports it', () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src.match(/MAX\(created_at\) AS last FROM audit_scores/g) ?? [],
      'a second copy is a query nothing reads').toHaveLength(1);
  });
});

describe('an average over nobody', () => {
  it('is unknown, not the worst possible score', async () => {
    const h = await getCustomerHealthOverview();
    expect(h.total_customers).toBe(0);
    expect(h.avg_health_score, 'zero out of a hundred, for having measured nobody').toBeNull();
  });

  it('is a real average once somebody is scored', async () => {
    const pid = await addCompany();
    for (const score of [80, 40]) {
      await query(
        `INSERT INTO customers (id, product_id, owner_id, email, health_score)
         VALUES (?,?,?,?,?)`, [nanoid(), pid, lastOwner, `${nanoid(6)}@example.com`, score]);
    }
    const h = await getCustomerHealthOverview();
    expect(h.avg_health_score).toBe(60);
  });

  it('is unknown when customers exist but none has been scored', async () => {
    const pid = await addCompany();
    await query(
      'INSERT INTO customers (id, product_id, owner_id, email) VALUES (?,?,?,?)',
      [nanoid(), pid, lastOwner, `${nanoid(6)}@example.com`]);
    const h = await getCustomerHealthOverview();
    expect(h.total_customers).toBe(1);
    expect(h.avg_health_score, 'one customer, no score').toBeNull();
  });
});

describe('the page the operator reads', () => {
  it('prints why each number is missing', () => {
    const src = readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8');
    expect(src).toMatch(/no decisions yet/);
    expect(src).toMatch(/nobody scored/);
    const stripped = stripComments(src, { lineComments: true });
    expect(stripped, 'the fallbacks that produced 100% and 0/100')
      .not.toMatch(/auto_execute_rate:\s*0\b/);
    expect(stripped).not.toMatch(/avg_health_score:\s*0\b/);
  });
});
