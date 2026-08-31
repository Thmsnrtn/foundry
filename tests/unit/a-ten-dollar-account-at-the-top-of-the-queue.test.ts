process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { rebuildPriorityQueue } from '../../src/services/scp/priority/ranker.js';

// =============================================================================
// A TEN-DOLLAR ACCOUNT AT THE TOP OF THE QUEUE.
//
// The "One Thing" banner is served to the founder as the single most important
// action right now. It is ordered by priority_score = urgency x impact, and the
// churn-risk impact term was computed a hundred times its own stated scale:
//
//     const impactScore = Math.min(10, mrrCents / 100); // $1 MRR = 0.01 impact
//
// `mrrCents / 100` is DOLLARS. So a dollar of MRR contributed 1.0 impact rather
// than 0.01, and the cap of 10 bound at TEN dollars a month instead of the
// thousand the comment describes. The dimension collapsed to two values: 1 for
// an unrecorded MRR, 10 for anything at or above $10.
//
// The consequence is an ordering, which is the thing the banner is: every
// at-risk customer worth $10/mo scored 7 x 10 = 70 and outranked an unresolved
// HIGH-severity failure pattern at 8 x 8 = 64. Under the documented scale that
// account scores 7 x 0.1 = 0.7 and ranks last, which is where a ten-dollar
// account belongs when something is on fire.
//
// AND THE PORTFOLIO CARD PRINTED A SCORE NOBODY MEASURED. `signal.hasData` is a
// contract `services/signal.ts` states in so many words — "a company Foundry
// had never measured appearing as a confident 85 out of 100" is the failure it
// exists to prevent — and the same file honours it three times: the fleet table
// renders "no data", the average excludes unmeasured companies, the sort puts
// them last. The card grid underneath printed `signal.score` raw, so the row
// saying "no data" sat directly above a card showing 80 at 3.5rem in the green
// tier colour.
// =============================================================================

const P = 'p_rank';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_r','c_r','r@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_r','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM priority_actions WHERE product_id = ?', [P]);
  await query('DELETE FROM customer_intelligence WHERE product_id = ?', [P]);
  await query('DELETE FROM pattern_matches WHERE product_id = ?', [P]);
  await query("DELETE FROM failure_patterns WHERE id = 'fp_checkout'");
});

async function atRiskCustomer(name: string, mrrCents: number): Promise<void> {
  await query(
    `INSERT INTO customer_intelligence
       (id, product_id, external_customer_id, account_name, email, mrr_cents,
        health_score, stage)
     VALUES (?, ?, ?, ?, ?, ?, 20, 'at_risk')`,
    [nanoid(), P, `cus_${name}`, name, `${name}@example.com`, mrrCents]);
}

/** A high-severity failure pattern matched against this company. Urgency 8,
 *  impact 8 — the thing a ten-dollar churn risk used to outrank. */
async function unresolvedHighSeverityPattern(): Promise<void> {
  await query(
    `INSERT INTO failure_patterns
       (id, pattern_name, description, category, warning_signals_json,
        mitigation_actions_json, match_criteria_json, severity)
     VALUES ('fp_checkout', 'Checkout 500s', 'Payments failing at checkout',
             'growth_stall', '[]', '[]', '{}', 'high')`);
  await query(
    `INSERT INTO pattern_matches
       (id, product_id, failure_pattern_id, match_score, matched_signals_json,
        first_detected_at)
     VALUES (?, ?, 'fp_checkout', 0.9, '[]', datetime('now'))`, [nanoid(), P]);
}

async function scoreFor(name: string): Promise<{ impact: number; priority: number }> {
  const r = await query(
    `SELECT impact_score, priority_score FROM priority_actions
      WHERE product_id = ? AND title LIKE ? AND is_active = 1`, [P, `${name}%`]);
  const row = r.rows[0] as unknown as { impact_score: number; priority_score: number } | undefined;
  return { impact: row?.impact_score ?? -1, priority: row?.priority_score ?? -1 };
}

describe('what a churning account is worth in the ranking', () => {
  it('does not cap a ten-dollar account at the top of the impact scale', async () => {
    await atRiskCustomer('Tiny', 1_000);          // $10/mo
    await rebuildPriorityQueue(P);

    const tiny = await scoreFor('Tiny');
    // The documented scale: $1 = 0.01, so $10 is 0.1 — floored at 1 by
    // Math.max, not raised to the cap.
    expect(tiny.impact).toBeLessThan(2);
  });

  it('still separates a large account from a small one', async () => {
    await atRiskCustomer('Tiny', 1_000);          // $10/mo
    await atRiskCustomer('Whale', 5_000_00);      // $5,000/mo
    await rebuildPriorityQueue(P);

    const tiny = await scoreFor('Tiny');
    const whale = await scoreFor('Whale');

    // Both used to be exactly 10, because both clear $10.
    expect(whale.impact).toBeGreaterThan(tiny.impact);
    expect(whale.priority).toBeGreaterThan(tiny.priority);
  });

  it('reaches the cap where the comment says it does, at a thousand a month', async () => {
    await atRiskCustomer('Big', 1_000_00);        // $1,000/mo
    await rebuildPriorityQueue(P);

    expect((await scoreFor('Big')).impact).toBeCloseTo(10, 6);
  });

  it('lets an operational failure outrank a trivial account', async () => {
    await atRiskCustomer('Tiny', 1_000);
    await unresolvedHighSeverityPattern();

    await rebuildPriorityQueue(P);

    const top = await query(
      `SELECT title, priority_score FROM priority_actions
        WHERE product_id = ? AND is_active = 1
        ORDER BY priority_score DESC LIMIT 1`, [P]);
    const title = (top.rows[0] as unknown as { title: string }).title;
    expect(title).toContain('Checkout 500s');
  });
});

describe('the portfolio card grid', () => {
  const src = readFileSync('src/routes/dashboard/portfolio.ts', 'utf8');

  it('honours the same hasData contract as the table beside it', () => {
    // Rendered HTML, so the check is on the template. The contract itself is
    // exercised where it is defined, in the signal tests.
    const card = src.slice(src.indexOf('portfolio-signal-number'));
    expect(card.slice(0, 120)).toContain('signal.hasData');
  });
});
