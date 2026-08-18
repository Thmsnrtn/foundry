// =============================================================================
// Tests: an eligibility floor is not a statistic
//
// The owner's decision is explicit: MIN_CONTRIBUTORS = 3 and
// PEER_SIGNAL_MIN_SAMPLE = 5 stay, and they are "conservative eligibility
// floors, not proof of broad statistical validity". The dashboard card was
// fixed to say so. The generator was not.
//
// It still told the model, twice:
//
//   system: "Only surface statistically significant insights."
//   user:   "Extract 1-3 statistically significant insights."
//
// So a model was instructed to produce claims of statistical significance from
// three companies and three rows, and it obliged. The number it invented for
// `confidence` was stored, used to RANK the insights, and rendered as
// "80% confidence" — a statistic-shaped presentation of a guess. `avg_impact`,
// the model's own estimate, was rendered as "avg impact: +12%", which reads as
// a measured mean across the network.
//
// Nothing about the floors changed. What changed is that the words describing
// them no longer overstate what they are, at every place the claim is written,
// stored, ranked, returned, or injected into another company's prompt.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const SRC = resolve(__dirname, '../../src/services/wisdom/network.ts');
const source = readFileSync(SRC, 'utf8');

const F = 'ncs_founder';
const P = 'ncs_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'ncs_clerk', 'ncs@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, sector_profile, growth_stage)
     VALUES (?,'Claim Co',?, 'active','marketplace','growth')`, [P, F]);
});

describe('the generator does not command a claim the data cannot carry', () => {
  // The prompt is the instruction the institution gives about how strongly to
  // speak. Asserting on it is asserting on the claim, one step before the
  // claim exists.
  const start = source.indexOf('const prompt = `Analyze these anonymized');
  const prompt = source.slice(start, source.indexOf('`;', start));

  it('never asks for statistical significance', () => {
    // The phrase may appear — it appears in the prohibition. What it may not
    // do is appear as an instruction. Every occurrence must be negated.
    const text = prompt.toLowerCase();
    for (const m of text.matchAll(/statistically significant|statistical significance/g)) {
      expect(text.slice(Math.max(0, m.index! - 120), m.index!),
        'the prompt asks the model for a claim three companies cannot support')
        .toMatch(/do not/);
    }
  });

  it('names the floor as a floor, in the prompt itself', () => {
    expect(prompt).toMatch(/eligibility floor/i);
  });

  it('forbids the neighbouring overstatements too', () => {
    // "Not significant" is easy to satisfy by saying "proven" instead.
    const instruction = prompt.toLowerCase();
    for (const word of ['proven', 'validated', 'consensus']) {
      expect(instruction, `the prompt must rule out "${word}", not just significance`)
        .toContain(word);
    }
  });

  it('and the system prompt agrees with the user prompt', () => {
    const sys = source.match(/'You are a cross-product pattern analyst[^']*'/)?.[0] ?? '';
    expect(sys, 'a system prompt is read first and weighs most').not.toBe('');
    expect(sys.toLowerCase()).not.toMatch(/statistically significant/);
    expect(sys.toLowerCase()).toMatch(/do not claim/);
  });
});

describe('the numbers are returned under the names of what they are', () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO cross_product_insights
         (id, sector, growth_stage, insight_type, description, sample_size,
          confidence, avg_impact, conditions, provenance_json, observed_through)
       VALUES ('ncs_i1','marketplace','growth','retention_tactic',
               'Companies that emailed at day 3 saw fewer cancellations.',
               4, 0.8, 12, NULL, ?, datetime('now','-10 days'))`,
      [JSON.stringify({ method: 'contributor-counted/v2', eligibility_floor_only: true })]);
  });

  it('distinguishes the model’s confidence from a statistical one', async () => {
    const { getRelevantInsights } = await import('../../src/services/wisdom/network.js');
    const [insight] = await getRelevantInsights(P);
    expect(insight).toBeDefined();
    expect(insight.model_confidence, 'the value is unchanged; only its name is honest')
      .toBeCloseTo(0.8);
    expect(insight.estimated_impact_pct).toBe(12);
    expect(insight.contributing_companies, 'the unit is companies, and it says so')
      .toBe(4);
    // The old names asserted measurement. They must not come back by accident.
    expect(insight as unknown as Record<string, unknown>).not.toHaveProperty('confidence');
    expect(insight as unknown as Record<string, unknown>).not.toHaveProperty('avg_impact');
  });

  it('hands the provenance to the surface, not just to the table', async () => {
    // Recording provenance and then dropping it before the one reachable
    // consumer is recording it for nobody.
    const { getRelevantInsights } = await import('../../src/services/wisdom/network.js');
    const [insight] = await getRelevantInsights(P);
    expect(insight.provenance, 'a claim that travels without its method is a bare assertion')
      .not.toBeNull();
    expect(insight.provenance!.eligibility_floor_only).toBe(true);
    expect(insight.observed_through, 'and how current it is').not.toBeNull();
  });

  it('tolerates a row written before provenance existed', async () => {
    // Migration 146 added the columns; rows predating it have none. A missing
    // method is "we did not record it", which must not crash the reader and
    // must not be mistaken for a recorded one.
    await query(
      `INSERT INTO cross_product_insights
         (id, sector, growth_stage, insight_type, description, sample_size,
          confidence, avg_impact, conditions)
       VALUES ('ncs_old','marketplace','growth','pricing_strategy','Older row.',
               5, 0.9, 20, NULL)`);
    const { getRelevantInsights } = await import('../../src/services/wisdom/network.js');
    const old = (await getRelevantInsights(P)).find((i) => i.id === 'ncs_old');
    expect(old, 'a pre-provenance row is still served').toBeDefined();
    expect(old!.provenance, 'and says it has no method rather than inventing one').toBeNull();
  });
});

describe('the claim survives the trip into another company’s prompt', () => {
  it('labels the estimate as an estimate where a model will read it', async () => {
    const { injectNetworkWisdom } = await import('../../src/services/wisdom/network.js');
    const out = await injectNetworkWisdom('CONTEXT', P);
    expect(out).toContain('CONTEXT');
    expect(out, 'the downstream model reasons about a founder from this text')
      .toMatch(/eligibility floor/i);
    expect(out).toMatch(/ESTIMATED/);
    expect(out).toMatch(/not measured/i);
    expect(out.toLowerCase(), 'nothing here is a finding about the reader’s company')
      .not.toMatch(/statistically significant/);
  });

  it('still names the unit as companies', async () => {
    const { injectNetworkWisdom } = await import('../../src/services/wisdom/network.js');
    const out = await injectNetworkWisdom('CONTEXT', P);
    expect(out).toMatch(/contributing companies/);
  });

  it('leaves the context alone when there is nothing to say', async () => {
    const { injectNetworkWisdom } = await import('../../src/services/wisdom/network.js');
    // A different sector has no rows; silence, not an empty header claiming a
    // section of peer evidence exists.
    await query(
      `INSERT INTO products (id, name, owner_id, status, sector_profile, growth_stage)
       VALUES ('ncs_quiet','Quiet Co',?, 'active','fintech','seed')`, [F]);
    expect(await injectNetworkWisdom('CONTEXT', 'ncs_quiet')).toBe('CONTEXT');
  });
});

describe('no mislabelled statistics helper is left lying about', () => {
  it('does not export a "statistical confidence" it never computed', () => {
    // Deleted: an uncalled export that blended sample size with a consistency
    // score and called the result statistical confidence. The next person
    // needing a confidence number would have found one already named for them.
    expect(source).not.toMatch(/computeInsightConfidence/);
    expect(source.toLowerCase()).not.toMatch(/compute statistical confidence/);
  });
});
