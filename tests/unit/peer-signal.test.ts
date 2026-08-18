// =============================================================================
// Tests: Cross-product peer signal reader (Phase 4.1)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { getPeerSignal, PEER_SIGNAL_MIN_SAMPLE } from '../../src/services/decisions/patterns.js';
import { nanoid } from 'nanoid';

beforeAll(async () => {
  // The migrations are the schema. Tables this file used to write by hand are
  // already here, in the shape the product actually has — including the NOT
  // NULL columns and foreign keys a hand-written stand-in leaves out.
  await runMigrations();
});

beforeEach(async () => {
  await executeRaw('DELETE FROM decision_patterns');
});

/** Each call is a DIFFERENT company unless a contributor is named. The reader
 * counts companies, so a helper that wrote every row as one company would test
 * the opposite of what these cases mean. */
async function addPattern(
  type: string, stage: string, option: string, outcome: string,
  market: string | null = null, contributor: string = nanoid(),
): Promise<void> {
  await query(
    `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage, risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction, market_category, contributor_hash)
     VALUES (?, ?, ?, 'green', '{}', ?, ?, ?, ?)`,
    [nanoid(), type, stage, option, outcome, market, contributor],
  );
}

describe('getPeerSignal', () => {
  it('abstains (returns null) below the minimum sample size', async () => {
    for (let i = 0; i < PEER_SIGNAL_MIN_SAMPLE - 1; i++) {
      await addPattern('pricing_change', 'pre_launch', 'raise_price', 'positive');
    }
    expect(await getPeerSignal({ decisionType: 'pricing_change', lifecycleStage: 'pre_launch' })).toBeNull();
  });

  it('returns the dominant option and its positive rate at/above the threshold', async () => {
    // Five companies chose raise_price (4 positive, 1 negative); two chose
    // hold. The threshold is on the CLAIM's population — the companies that
    // chose the option being reported — because that is what the sentence
    // asserts. Four backers used to be enough here, and the sentence it
    // produced was about "founders" who might all have been one.
    for (let i = 0; i < 4; i++) {
      await addPattern('pricing_change', 'pre_launch', 'raise_price', 'positive');
    }
    await addPattern('pricing_change', 'pre_launch', 'raise_price', 'negative');
    await addPattern('pricing_change', 'pre_launch', 'hold', 'neutral');
    await addPattern('pricing_change', 'pre_launch', 'hold', 'neutral');

    const signal = await getPeerSignal({ decisionType: 'pricing_change', lifecycleStage: 'pre_launch' });
    expect(signal).not.toBeNull();
    expect(signal!.sampleSize).toBe(7);
    expect(signal!.dominantOption).toBe('raise_price');
    expect(signal!.dominantOptionCount).toBe(5);
    expect(signal!.positiveRate).toBeCloseTo(0.8, 5);
    expect(signal!.summary).toContain('80%');
  });

  it('scopes by market category when provided', async () => {
    for (let i = 0; i < 5; i++) await addPattern('churn_response', 'growth', 'discount', 'positive', 'b2b_saas');
    for (let i = 0; i < 5; i++) await addPattern('churn_response', 'growth', 'call', 'negative', 'consumer');

    const b2b = await getPeerSignal({ decisionType: 'churn_response', lifecycleStage: 'growth', marketCategory: 'b2b_saas' });
    expect(b2b!.sampleSize).toBe(5);
    expect(b2b!.dominantOption).toBe('discount');

    // Consumer market has 5, but a non-existent market abstains.
    expect(await getPeerSignal({ decisionType: 'churn_response', lifecycleStage: 'growth', marketCategory: 'healthcare' })).toBeNull();
  });
});
