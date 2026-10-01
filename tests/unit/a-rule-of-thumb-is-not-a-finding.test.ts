process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

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
// Wherever they are shown they arrive beside a match score and signals drawn
// from a company's own metrics — the context that turns a rule of thumb into a
// finding about that company. The direction each describes is worth saying; the
// number was never measured, so it is not stated in the library the shipped
// patterns are seeded from, which is the only place it could re-enter.
//
// And `leading_indicators` — the table migration 023 created for exactly this
// idea, with `confidence` and `sample_size` columns — was never written to by
// anything, because Foundry has never had a way to establish those numbers.
// Migration 205 removed it.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

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
