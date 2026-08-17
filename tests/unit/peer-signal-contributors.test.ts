// =============================================================================
// Tests: "5 founders at your stage chose X" — five what?
//
// `getPeerSignal` abstained below five ROWS and then wrote a sentence about
// FOUNDERS. One company that made five similar decisions produced
// "5 founders at your stage who chose X saw a positive outcome 80% of the
// time", shown in another company's decision queue. Five rows is one company
// as easily as five, and the sentence asserted the second.
//
// The same misbinding as the wisdom network, in the reader rather than the
// aggregator, and reaching a founder's screen directly rather than through an
// insight row. §7: ROW COUNT, DISTINCT CONTRIBUTORS and COHORT SIZE are three
// different numbers, and only one of them is a peer count.
//
// Concentration is the second half. Counting rows also let one opinionated
// company outvote several others, so each company now counts once per option.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getPeerSignal } from '../../src/services/decisions/patterns.js';
import { contributorHash } from '../../src/services/wisdom/network.js';

const TYPE = 'pricing_change';
const STAGE = 'peer_stage';

async function pattern(company: string, option: string, outcome: string): Promise<void> {
  await query(
    `INSERT INTO decision_patterns
       (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
        key_metrics_context, option_chosen_category, outcome_direction,
        outcome_magnitude, market_category, contributor_hash)
     VALUES (?, ?, ?, 'green', '{}', ?, ?, 'significant', 'peer_market', ?)`,
    [`ps_${Math.random().toString(36).slice(2)}`, TYPE, STAGE, option, outcome,
      contributorHash(company)]);
}

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query(`DELETE FROM decision_patterns WHERE product_lifecycle_stage = ?`, [STAGE]);
});

describe('a peer signal counts companies', () => {
  it('abstains when one company supplied every row', async () => {
    for (let i = 0; i < 8; i++) await pattern('one_company', 'raise', 'positive');
    expect(await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE }),
      'eight decisions by one company are not eight peers').toBeNull();
  });

  it('speaks when enough distinct companies agree', async () => {
    for (let i = 0; i < 5; i++) await pattern(`co_${i}`, 'raise', 'positive');
    const signal = await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE });
    expect(signal).not.toBeNull();
    expect(signal!.sampleSize).toBe(5);
    expect(signal!.dominantOptionCount).toBe(5);
    expect(signal!.summary).toMatch(/5 companies/);
    expect(signal!.summary, 'the sentence must say what was counted')
      .not.toMatch(/founders/);
  });

  it('does not let one company outvote several', async () => {
    // One company chose 'hold' ten times; five companies chose 'raise' once
    // each. Counting rows made 'hold' the dominant peer choice.
    for (let i = 0; i < 10; i++) await pattern('loud_company', 'hold', 'positive');
    for (let i = 0; i < 5; i++) await pattern(`quiet_${i}`, 'raise', 'positive');
    const signal = await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE });
    expect(signal!.dominantOption,
      'ten decisions by one company are one company that made that call')
      .toBe('raise');
    expect(signal!.dominantOptionCount).toBe(5);
  });

  it('abstains when the cohort is large but split', async () => {
    // Six companies, six different answers. Nothing here is worth telling a
    // seventh, however many rows there are.
    for (let i = 0; i < 6; i++) await pattern(`split_${i}`, `option_${i}`, 'positive');
    expect(await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE })).toBeNull();
  });

  it('ignores rows that name no contributor', async () => {
    // Written before migration 144. They cannot be attributed to a company, so
    // they cannot support a claim about companies.
    for (let i = 0; i < 9; i++) {
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category, outcome_direction,
            outcome_magnitude, market_category)
         VALUES (?, ?, ?, 'green', '{}', 'raise', 'positive', 'significant', 'peer_market')`,
        [`ps_legacy_${i}`, TYPE, STAGE]);
    }
    expect(await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE })).toBeNull();
  });

  it('reports the positive rate across companies, not across rows', async () => {
    // Four companies saw a positive outcome, one did not — 80%. The losing
    // company also has four rows, which under row counting would have dragged
    // it to 50%.
    for (let i = 0; i < 4; i++) await pattern(`won_${i}`, 'raise', 'positive');
    for (let i = 0; i < 4; i++) await pattern('lost_company', 'raise', 'negative');
    const signal = await getPeerSignal({ decisionType: TYPE, lifecycleStage: STAGE });
    expect(signal!.dominantOptionCount).toBe(5);
    expect(Math.round(signal!.positiveRate * 100)).toBe(80);
  });
});
