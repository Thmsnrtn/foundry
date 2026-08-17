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

import { beforeAll, describe, expect, it } from 'vitest';
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
  it('reports contributors rather than cohort size', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/services/wisdom/network.ts'), 'utf8');
    // sample_size on the insight is what injectNetworkWisdom prints into
    // another founder's prompt. It must be the contributor count.
    expect(source).toMatch(/contributorCount/);
    expect(source, 'the cohort size must not be stored as the sample size')
      .not.toMatch(/insight\.confidence,\s*$\s*.*sampleSize/m);
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
