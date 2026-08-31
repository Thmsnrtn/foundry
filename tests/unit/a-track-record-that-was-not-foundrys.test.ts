process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getTrustLedger, TRUST_MIN_SAMPLE } from '../../src/services/trust/ledger.js';
import {
  foundryJudgementTestedSql, foundryJudgementWasTested,
} from '../../src/services/decisions/foundry-proposed.js';
import { getDecisionQualityTrends } from '../../src/services/scp/founder/decision-tracker.js';

// =============================================================================
// A TRACK RECORD THAT WAS NOT FOUNDRY'S.
//
// The trust ledger is where autonomy is PRICED: it measures a category's track
// record and, when it clears the bar on a real sample, PROPOSES to the founder
// that Foundry handle that category alone. Its header says the record is of
// "founder-approved agent proposals whose measured outcome was positive".
//
// Its only filter was `decided_by = 'founder'` — which says who RESOLVED the
// row, not who proposed it. Founder-authored decisions land in the same table
// with the same category and gate; Ask Foundry and the mobile app both insert
// them. So a founder who dictates their own strategic calls, resolves them, and
// records good outcomes crossed the bar on their OWN judgment and was then
// shown a proposal saying Foundry had earned the gate. A legitimacy the query
// could not support, offered at the exact moment the founder decides whether to
// grant authority.
//
// THIS IS THE THIRD PLACE TO ASK THE SAME QUESTION. The autopilot ladder banks
// clean cycles on it; the shadow ledger prints an agreement rate on it; this
// proposes a graduation on it. Each carried its own copy — one in TypeScript,
// one in SQL, and this one not at all. Two copies are fine when pinned; three,
// one of them absent, is one rule with three answers. It is written once in
// `decisions/foundry-proposed.ts`, and the two forms are asserted against each
// other below rather than each against a constant.
//
// AND A RATE OVER AN EMPTY TABLE WAS BOTH A CRITICISM AND A COMPLIMENT.
// `decision_quality_scores` has no writer — `recordDecisionContext` is called
// from nowhere — so /founder-intelligence showed "Full Context 0%" in RED, a
// finding about how carelessly the founder decides, beside "Override Rate 0%"
// in GREEN, a compliment about how rarely they overrule their agents. One empty
// table, two opposite verdicts, on one page.
// =============================================================================

const P = 'p_trust';
let seq = 0;

async function decision(opts: {
  category?: string; decidedBy?: string; recommendation?: string | null;
  chosen?: string | null; valence?: number; gate?: number;
}): Promise<void> {
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status,
       decided_by, recommendation, chosen_option, outcome_valence, decided_at)
     VALUES (?, ?, ?, ?, 'x', 'y', 'approved', ?, ?, ?, ?, datetime('now'))`,
    [`tl${++seq}`, P, opts.category ?? 'marketing', opts.gate ?? 2,
     opts.decidedBy ?? 'founder', opts.recommendation ?? null,
     opts.chosen ?? null, opts.valence ?? 1]);
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_t','c_t','t@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_t','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM decisions WHERE product_id = ?', [P]); });

describe('what the trust ledger is allowed to count', () => {
  it('proposes nothing on a founder\'s own good decisions', async () => {
    // Ten strategic calls the founder wrote, resolved and got right. Foundry
    // never offered a view on any of them.
    for (let i = 0; i < TRUST_MIN_SAMPLE + 2; i++) {
      await decision({ recommendation: null, chosen: 'their own call', valence: 1 });
    }

    const ledger = await getTrustLedger(P);

    expect(ledger.proposals).toEqual([]);
    expect(ledger.categories.find((c) => c.category === 'marketing')?.decided ?? 0).toBe(0);
  });

  it('proposes when Foundry recommended it, the founder took it, and it worked', async () => {
    for (let i = 0; i < TRUST_MIN_SAMPLE + 2; i++) {
      await decision({ recommendation: 'Run the campaign', chosen: 'run the campaign', valence: 1 });
    }

    const ledger = await getTrustLedger(P);

    expect(ledger.proposals.length).toBe(1);
    expect(ledger.proposals[0]).toContain('marketing');
  });

  it('does not count a decision where the founder overruled Foundry and was right', async () => {
    for (let i = 0; i < TRUST_MIN_SAMPLE + 2; i++) {
      await decision({ recommendation: 'Raise prices', chosen: 'Hold prices', valence: 1 });
    }

    const ledger = await getTrustLedger(P);

    expect(ledger.proposals).toEqual([]);
  });

  it('counts a decision Foundry made itself', async () => {
    for (let i = 0; i < TRUST_MIN_SAMPLE + 2; i++) {
      await decision({ decidedBy: 'second_self', valence: 1 });
    }

    expect((await getTrustLedger(P)).proposals.length).toBe(1);
  });
});

describe('one rule, one home', () => {
  const cases: Array<{ decided_by: string; recommendation: string | null; chosen_option: string | null }> = [
    { decided_by: 'founder', recommendation: 'Raise Prices', chosen_option: '  RAISE prices ' },
    { decided_by: 'founder', recommendation: 'raise prices', chosen_option: 'hold prices' },
    { decided_by: 'founder', recommendation: '  ', chosen_option: '' },
    { decided_by: 'founder', recommendation: null, chosen_option: 'anything' },
    { decided_by: 'second_self', recommendation: null, chosen_option: null },
    { decided_by: 'founder', recommendation: 'ship it', chosen_option: ' Ship It' },
  ];

  it('answers the same in SQL as it does in TypeScript', async () => {
    for (const c of cases) {
      await decision({
        category: 'product', decidedBy: c.decided_by,
        recommendation: c.recommendation, chosen: c.chosen_option, valence: 1,
      });
    }

    const bySql = await query(
      `SELECT COUNT(*) AS n FROM decisions
        WHERE product_id = ? AND category = 'product' AND ${foundryJudgementTestedSql()}`, [P]);
    const sqlCount = Number((bySql.rows[0] as unknown as { n: number }).n);
    const tsCount = cases.filter(foundryJudgementWasTested).length;

    // Asserted against each other, not against a constant, so a change to
    // either form has to move both.
    expect(sqlCount).toBe(tsCount);
    expect(sqlCount).toBe(3);
  });
});

describe('a rate over a table nothing writes', () => {
  it('is neither a red finding nor a green one', async () => {
    const trends = await getDecisionQualityTrends(P);

    expect(trends.decisions_with_full_context_pct).toBeNull();
    expect(trends.override_rate_30d).toBeNull();
    expect(trends.override_rate_90d).toBeNull();
    // The one field that was already honest, kept honest.
    expect(trends.average_quality_score).toBeNull();
  });
});
