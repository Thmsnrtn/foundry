// =============================================================================
// Tests: Cross-product peer signal reader (Phase 4.1)
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { query, executeRaw } from '../../src/db/client.js';
import { getPeerSignal, PEER_SIGNAL_MIN_SAMPLE } from '../../src/services/decisions/patterns.js';
import { nanoid } from 'nanoid';

beforeAll(async () => {
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS decision_patterns (
      id TEXT PRIMARY KEY,
      decision_type TEXT NOT NULL,
      product_lifecycle_stage TEXT NOT NULL,
      risk_state_at_decision TEXT NOT NULL DEFAULT 'green',
      key_metrics_context TEXT NOT NULL DEFAULT '{}',
      option_chosen_category TEXT NOT NULL,
      outcome_direction TEXT,
      outcome_magnitude TEXT,
      outcome_timeframe_days INTEGER,
      market_category TEXT,
      contributing_factors TEXT,
      scenario_accuracy_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
});

beforeEach(async () => {
  await executeRaw('DELETE FROM decision_patterns');
});

async function addPattern(type: string, stage: string, option: string, outcome: string, market: string | null = null): Promise<void> {
  await query(
    `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage, risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction, market_category)
     VALUES (?, ?, ?, 'green', '{}', ?, ?, ?)`,
    [nanoid(), type, stage, option, outcome, market],
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
    // 4 chose raise_price (3 positive, 1 negative); 2 chose hold (both neutral). n=6.
    await addPattern('pricing_change', 'pre_launch', 'raise_price', 'positive');
    await addPattern('pricing_change', 'pre_launch', 'raise_price', 'positive');
    await addPattern('pricing_change', 'pre_launch', 'raise_price', 'positive');
    await addPattern('pricing_change', 'pre_launch', 'raise_price', 'negative');
    await addPattern('pricing_change', 'pre_launch', 'hold', 'neutral');
    await addPattern('pricing_change', 'pre_launch', 'hold', 'neutral');

    const signal = await getPeerSignal({ decisionType: 'pricing_change', lifecycleStage: 'pre_launch' });
    expect(signal).not.toBeNull();
    expect(signal!.sampleSize).toBe(6);
    expect(signal!.dominantOption).toBe('raise_price');
    expect(signal!.dominantOptionCount).toBe(4);
    expect(signal!.positiveRate).toBeCloseTo(0.75, 5);
    expect(signal!.summary).toContain('75%');
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
