process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { seedDefaultPatterns } from '../../src/services/network/failure-library.js';

// =============================================================================
// A RULE OF THUMB IS NOT A FINDING.
//
// The failure-pattern library ships with Foundry: named shapes, warning
// signals, match criteria, and a `typical_lead_time_days`. It is written by
// hand and derived from no company's data — not this company's, not the
// benchmark pool's, not the network's.
//
// Four of its descriptions stated frequencies as if something had counted them:
// "typically see churn double within 60 days", "most companies in this pattern
// see negative MRR growth within 8 weeks", "the most common failure mode for
// B2B SaaS at the $10k-50k MRR range", "NPS captures the deterioration 60-90
// days before it hits revenue".
//
// A founder reads those on a card headed by their own match score, beside
// signals drawn from their own metrics — the context that turns a rule of thumb
// into a finding about their company. The direction each describes is worth
// saying; the number was never measured.
//
// And `leading_indicators` — the table migration 023 created for exactly this
// idea, with `confidence` and `sample_size` columns — was never written to by
// anything, because Foundry has never had a way to establish those numbers.
// Migration 205 removed it.
// =============================================================================

const LIB = stripComments(
  readFileSync('src/services/network/failure-library.ts', 'utf8'), { lineComments: true });
const CARD = stripComments(
  readFileSync('src/routes/dashboard/network-intelligence.ts', 'utf8'), { lineComments: true });

beforeAll(async () => { await runMigrations(); });

describe('the shipped pattern library', () => {
  it('states no frequency it has not counted', () => {
    // Comments stripped: the paragraph above the seeds quotes all four.
    for (const claim of [
      'typically see churn double within 60 days',
      'most companies in this pattern see negative MRR growth within 8 weeks',
      'the most common failure mode for B2B SaaS',
      'captures the deterioration 60-90 days before it hits revenue',
    ]) {
      expect(LIB, `a counted-sounding claim nothing counted: ${claim}`).not.toContain(claim);
    }
  });

  it('still says what each shape is and what to do about it', async () => {
    await seedDefaultPatterns();
    const rows = await query(
      "SELECT pattern_name, description, mitigation_actions_json FROM failure_patterns WHERE id = 'fp_churn_precursor'");
    const row = rows.rows[0] as unknown as
      { pattern_name: string; description: string; mitigation_actions_json: string };

    expect(row.pattern_name).toBe('Churn Precursor');
    expect(row.description).toContain('accelerating revenue loss');
    expect(JSON.parse(row.mitigation_actions_json)).toHaveLength(4);
  });

  it('keeps the lead time, labelled as the kind of number it is', () => {
    expect(CARD).toContain('rule of thumb');
    expect(CARD).not.toMatch(/>~\$\{match\.days_until_typical_failure\}d lead time</);
  });

  it('tells the founder which half of the card is theirs', () => {
    expect(CARD).toContain('The pattern is one Foundry ships');
    expect(CARD).toContain('not a\n          measurement of your company');
  });
});

describe('the table that would have held the measurements', () => {
  it('is gone rather than empty', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='leading_indicators'");
    expect(rows.rows).toHaveLength(0);
  });

  it('is named nowhere in the source', () => {
    const src = stripComments(
      readFileSync('src/services/intelligence/predictive.ts', 'utf8'), { lineComments: true });
    expect(src).not.toContain('leading_indicators');
    // And the header that claimed the capability no longer does.
    expect(src).not.toMatch(/^\/\/ Leading indicators, pre-stressor detection/m);
  });
});
