// =============================================================================
// Tests: what a cross-product insight is allowed to claim
//
// The wisdom network takes decision patterns from consenting companies and
// turns them into insights that are injected into OTHER companies' prompts —
// competitors in the same sector and stage. Its file header states the
// guarantee: "no individual product data surfaces. Min sample size = 10."
//
// Neither half was enforced where it mattered.
//
// The `>= 10` was counted on the wrong population. `MIN_SAMPLE_SIZE` gated the
// COHORT — how many opted-in products exist in this sector and stage — while
// the patterns being analysed were selected with `HAVING cnt >= 3`, three ROWS,
// which one company making three similar decisions satisfies on its own. So an
// insight could be derived from a single company and shown to its competitors,
// under a header promising the opposite.
//
// And the number travelled. `sample_size` recorded on the insight was the
// cohort count, and `injectNetworkWisdom` writes it into another founder's
// prompt as "[Network insight, 12 products, 80% confidence]". Twelve products
// existed. Twelve products did not contribute. §11: the provenance has to
// survive into the claim, and here a number about one population was presented
// as a number about another.
//
// The fix keeps the guarantee rather than weakening the claim: a contributor
// hash lets the aggregation require k DISTINCT contributors without knowing who
// any of them are, and the number reported is the one that was measured.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';

// The model call is stubbed: every assertion here is about which NUMBER is
// recorded, and a real Opus call would make the test about the narrative and
// about having an API key.
vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async () => ({
    content: JSON.stringify([{
      insight_type: 'pricing_strategy', description: 'Raising prices worked.',
      confidence: 0.8, avg_impact: 12, conditions: null,
    }]),
    model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { contributorHash, MIN_CONTRIBUTORS } from '../../src/services/wisdom/network.js';

beforeAll(async () => {
  await runMigrations();
});

describe('the contributor hash identifies without naming', () => {
  it('is stable for one product', () => {
    expect(contributorHash('prod_a')).toBe(contributorHash('prod_a'));
  });

  it('differs between products', () => {
    expect(contributorHash('prod_a')).not.toBe(contributorHash('prod_b'));
  });

  it('does not contain the product id', () => {
    // The whole point of writing a hash rather than the id: the aggregation can
    // count distinct contributors without the table being able to say who they
    // were.
    expect(contributorHash('prod_a')).not.toContain('prod_a');
    expect(contributorHash('prod_a')).toMatch(/^[0-9a-f]{16,}$/);
  });
});

describe('an insight needs contributors, not just a cohort', () => {
  it('refuses to publish a pattern that came from too few companies', async () => {
    const { aggregateInsights } = await import('../../src/services/wisdom/network.js');

    // A cohort of twelve opted-in companies in one sector/stage...
    for (let i = 0; i < 12; i++) {
      await query(
        `INSERT INTO founders (id, clerk_user_id, email, wisdom_network_opted_in)
         VALUES (?,?,?,1)`, [`wn_f${i}`, `wn_c${i}`, `wn${i}@example.com`]);
      await query(
        `INSERT INTO products (id, name, owner_id, status, sector_profile, growth_stage)
         VALUES (?,?,?,'active','vertical_saas','growth')`,
        [`wn_p${i}`, `Co ${i}`, `wn_f${i}`]);
    }

    // ...but every pattern in the table came from ONE of them.
    for (let i = 0; i < 5; i++) {
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category,
            outcome_direction, outcome_magnitude, market_category, contributor_hash)
         VALUES (?, 'pricing_change', 'growth', 'green', '{}', 'raise',
                 'positive', 'significant', 'vertical_saas', ?)`,
        [`wn_dp${i}`, contributorHash('wn_p0')]);
    }

    const generated = await aggregateInsights();
    expect(generated,
      'one company making five decisions is not a network insight about twelve')
      .toBe(0);
    const published = await query(
      `SELECT id FROM cross_product_insights WHERE sector = 'vertical_saas'`);
    expect(published.rows.length).toBe(0);
  });

  it('needs at least MIN_CONTRIBUTORS distinct companies', () => {
    expect(MIN_CONTRIBUTORS).toBeGreaterThanOrEqual(3);
  });
});

describe('the number in the claim is the number that was measured', () => {
  it('publishes the contributor count, not the cohort size', async () => {
    // Behavioural, not textual: an earlier version of this test only checked
    // that the word appeared in the file, and a mutant that stored the cohort
    // size again survived it. What matters is the number that lands in the row
    // a founder is eventually shown.
    const { aggregateInsights } = await import('../../src/services/wisdom/network.js');

    // Cohort of twelve, of whom exactly six contributed this pattern. Six
    // rather than four because the contributor floor is now one shared
    // constant at 5 — the point of the fixture is that the published number is
    // the CONTRIBUTORS and not the cohort, and it needs the two to differ.
    for (let i = 0; i < 12; i++) {
      await query(
        `INSERT INTO founders (id, clerk_user_id, email, wisdom_network_opted_in)
         VALUES (?,?,?,1)`, [`cn_f${i}`, `cn_c${i}`, `cn${i}@example.com`]);
      await query(
        `INSERT INTO products (id, name, owner_id, status, sector_profile, growth_stage)
         VALUES (?,?,?,'active','marketplace','growth')`,
        [`cn_p${i}`, `Co ${i}`, `cn_f${i}`]);
    }
    for (let i = 0; i < 6; i++) {
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category,
            outcome_direction, outcome_magnitude, market_category, contributor_hash)
         VALUES (?, 'pricing_change', 'growth', 'green', '{}', 'raise',
                 'positive', 'significant', 'marketplace', ?)`,
        [`cn_dp${i}`, contributorHash(`cn_p${i}`)]);
    }

    await aggregateInsights();

    const published = await query(
      `SELECT sample_size FROM cross_product_insights WHERE sector = 'marketplace'`);
    expect(published.rows.length, 'six contributors clears the threshold').toBeGreaterThan(0);
    for (const row of published.rows as unknown as Array<Record<string, unknown>>) {
      expect(Number(row.sample_size),
        'the published number must be the companies that contributed, not the cohort')
        .toBe(6);
    }
  });

  it('says what it is counting where a founder reads it', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/services/wisdom/network.ts'), 'utf8');
    expect(source).toMatch(/contributing companies|companies contributed/i);
  });
});

describe('the write side still requires consent', () => {
  it('has not been loosened by any of this', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/services/decisions/patterns.ts'), 'utf8');
    expect(source).toMatch(/hasConsent\(input\.productId, 'cross_company_patterns'\)/);
  });
});

// =============================================================================
// §9: a claim that crosses a tenant boundary carries its provenance.
//
// A network insight is derived from several companies' decisions and injected
// into a competitor's prompt. The row recorded what it concluded and nothing
// about how — so "12 contributing companies" could be, and was, the cohort size
// instead, invisibly, because nothing on the row could be checked against
// anything.
// =============================================================================

describe('a cross-company claim records how it was made', () => {
  it('stores the population, the unit, the support and the window', async () => {
    const { aggregateInsights, AGGREGATION_METHOD_VERSION } = await import(
      '../../src/services/wisdom/network.js');

    // Twelve, because the cohort floor (MIN_SAMPLE_SIZE) gates which
    // sector/stage groups are aggregated at all; the contributor floor is a
    // separate, later question about who actually backed the pattern.
    for (let i = 0; i < 12; i++) {
      await query(
        `INSERT INTO founders (id, clerk_user_id, email, wisdom_network_opted_in)
         VALUES (?,?,?,1)`, [`pv_f${i}`, `pv_c${i}`, `pv${i}@example.com`]);
      await query(
        `INSERT INTO products (id, name, owner_id, status, sector_profile, growth_stage)
         VALUES (?,?,?,'active','fintech','growth')`, [`pv_p${i}`, `Co ${i}`, `pv_f${i}`]);
    }
    for (let i = 0; i < 6; i++) {
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category,
            outcome_direction, outcome_magnitude, market_category, contributor_hash)
         VALUES (?, 'pricing_change', 'growth', 'green', '{}', 'raise',
                 'positive', 'significant', 'fintech', ?)`,
        [`pv_dp${i}`, contributorHash(`pv_p${i}`)]);
    }

    await aggregateInsights();

    const row = (await query(
      `SELECT provenance_json, observed_through, sample_size
         FROM cross_product_insights WHERE sector = 'fintech'`))
      .rows[0] as Record<string, string>;
    expect(row, 'six contributors clears the floor').toBeTruthy();

    const p = JSON.parse(row.provenance_json) as Record<string, unknown>;
    expect(p.method).toBe(AGGREGATION_METHOD_VERSION);
    expect(p.unit, 'the unit is the claim').toBe('distinct contributing companies');
    expect(p.distinct_contributors).toBe(6);
    expect((p.population as Record<string, unknown>).cohort_products).toBe(12);
    expect(p.distinct_contributors,
      'the contributor count and the cohort count are different numbers and both are recorded')
      .not.toBe((p.population as Record<string, unknown>).cohort_products);
    expect(Array.isArray(p.excluded)).toBe(true);
    expect(p.eligibility_floor_only,
      'three companies is a floor for eligibility, not evidence of significance')
      .toBe(true);
    expect(row.observed_through).toBeTruthy();
  });

  it('names no contributing company', async () => {
    // The provenance is for reconstructing the CLAIM, not for identifying who
    // is behind it. A competitor reads this insight.
    const row = (await query(
      `SELECT provenance_json FROM cross_product_insights WHERE sector = 'fintech'`))
      .rows[0] as Record<string, string>;
    for (let i = 0; i < 12; i++) {
      expect(row.provenance_json).not.toContain(`pv_p${i}`);
      expect(row.provenance_json).not.toContain(contributorHash(`pv_p${i}`));
    }
  });
});

describe('an old claim is not a current one', () => {
  it('is not injected into a prompt once its observations have aged out', async () => {
    const { getRelevantInsights, INSIGHT_FRESHNESS_DAYS } = await import(
      '../../src/services/wisdom/network.js');
    expect(await getRelevantInsights('pv_p0'), 'fresh insight is served')
      .not.toHaveLength(0);

    await query(
      `UPDATE cross_product_insights SET observed_through = datetime('now', ?)
        WHERE sector = 'fintech'`, [`-${INSIGHT_FRESHNESS_DAYS + 30} days`]);
    expect(await getRelevantInsights('pv_p0'),
      'a row existing is not a claim being current').toHaveLength(0);
  });
});
