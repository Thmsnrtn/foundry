process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { PEER_SIGNAL_MIN_SAMPLE } from '../../src/services/decisions/patterns.js';
import { topPeerValidatedDecisionTypes } from '../../src/services/intelligence/peer-signal.js';

// =============================================================================
// "FIVE FOUNDERS LIKE YOU" MUST MEAN FIVE COMPANIES.
//
// `decisions/patterns.ts` documents this defect as fixed on its own reader, and
// exports the rule. Two other readers kept the row count:
//
//   • `intelligence/peer-signal.ts` — on the dashboard home, every load, no
//     consent gate. One company that made five similar decisions was presented
//     to its competitor as five peers.
//   • `intelligence/predictive.ts` — "N similar products saw negative
//     outcomes", where N was rows.
//
// The consent-gated reader is the careful one and is unreachable in production
// (`cross_company_patterns` is not in migration 041's CHECK, so it can never be
// granted). The ungated readers are the ones a founder actually sees. That is
// why counting correctly here mattered more than there.
// =============================================================================

const STAGE = 'growth';

async function pattern(contributor: string, direction: string, type = 'pricing'): Promise<void> {
  await query(
    `INSERT INTO decision_patterns
       (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
        key_metrics_context, option_chosen_category, outcome_direction,
        outcome_timeframe_days, contributor_hash)
     VALUES (?,?,?,'green','{}','raise_price',?,30,?)`,
    [`dp_${Math.random().toString(36).slice(2)}`, type, STAGE, direction, contributor]);
}

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM decision_patterns'); });

describe('the peer card on the dashboard', () => {
  it('says nothing when one company made every one of the decisions', async () => {
    for (let i = 0; i < PEER_SIGNAL_MIN_SAMPLE + 3; i += 1) await pattern('company_a', 'positive');
    expect(await topPeerValidatedDecisionTypes(STAGE)).toEqual([]);
  });

  it('speaks once enough different companies have', async () => {
    for (let i = 0; i < PEER_SIGNAL_MIN_SAMPLE; i += 1) await pattern(`company_${i}`, 'positive');
    const signals = await topPeerValidatedDecisionTypes(STAGE);
    expect(signals).toHaveLength(1);
    expect(signals[0].sample_size).toBe(PEER_SIGNAL_MIN_SAMPLE);
  });

  it('does not inflate the count when one company contributes repeatedly', async () => {
    for (let i = 0; i < PEER_SIGNAL_MIN_SAMPLE; i += 1) await pattern(`company_${i}`, 'positive');
    for (let i = 0; i < 20; i += 1) await pattern('company_0', 'positive');
    const signals = await topPeerValidatedDecisionTypes(STAGE);
    expect(signals[0].sample_size).toBe(PEER_SIGNAL_MIN_SAMPLE);
  });

  it('will not count a row that cannot be attributed to a company', async () => {
    for (let i = 0; i < PEER_SIGNAL_MIN_SAMPLE; i += 1) {
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category, outcome_direction,
            outcome_timeframe_days)
         VALUES (?,'pricing',?,'green','{}','raise_price','positive',30)`,
        [`dp_anon_${i}`, STAGE]);
    }
    expect(await topPeerValidatedDecisionTypes(STAGE)).toEqual([]);
  });

  it('uses the one rule, not a third copy of it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const file of ['intelligence/peer-signal.ts', 'intelligence/predictive.ts']) {
      const source = readFileSync(resolve(__dirname, `../../src/services/${file}`), 'utf8');
      expect(source, `${file} should import the shared floor`)
        .toContain('PEER_SIGNAL_MIN_SAMPLE');
      expect(source, `${file} should count distinct contributors`)
        .toContain('COUNT(DISTINCT contributor_hash)');
    }
  });
});
