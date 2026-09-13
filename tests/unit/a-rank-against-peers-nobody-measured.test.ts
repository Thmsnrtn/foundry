process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { scoreRevenueQuality } from '../../src/services/scp/exit/ma-readiness.js';

// =============================================================================
// A CHURN CHECK THAT COULD NOT FAIL.
//
// `metric_snapshots.churn_rate` and `.activation_rate` are 0–1 FRACTIONS. The
// ingest validator pins it — `z.number().min(0).max(1)` — and every other
// surface converts with `* 100`. `services/ai/measured.ts` exists for exactly
// this and carries the explanation. One reader had not been converted:
//
//   • The M&A revenue-quality scorer compared the raw fraction against
//     thresholds of 2, 3 and 5 PERCENTAGE POINTS. Every measured churn rate
//     therefore cleared the best band — including a company churning 100% of
//     its revenue a month, which arrives here as 1. Churn is 3 of the 10 raw
//     points in revenue quality, the heaviest-weighted dimension in the overall
//     score, which drives `ready_to_be_acquired` and the ARR multiple range
//     printed to the founder and fed into the acquisition thesis.
//
//     THE TELL WAS INSIDE THE BRANCH. A measured churn scored 3 of 3
//     unconditionally while an unknown one scored 1: the fallback and the
//     measurement disagreed about the arithmetic that follows, which is what a
//     units bug looks like from outside. NRR two branches up was already
//     converted before its own 110/100/90 comparison.
//
// This file once also covered the commercial benchmarks page, which read the
// same fractions and printed them with a bare '%'. That page and its
// `fmtMetricValue` / `rankAgainstPeers` / `percentileLabel` helpers were part of
// the Commercial Foundry surface and have been removed, so those cases went
// with them. The scorer below is the reader of these columns that survives, and
// the units rule is asserted where it still runs.
// =============================================================================

describe('the M&A churn band', () => {
  it('gives a company churning 5% a month no churn points', () => {
    // 0.05 is five percent. Read raw it is comfortably under a threshold of 2.
    const bad = scoreRevenueQuality(null, 0.05, []);
    const good = scoreRevenueQuality(null, 0.01, []);

    expect(good).toBeGreaterThan(bad);
  });

  it('does not award the best band to a company losing all its revenue', () => {
    // 1 is one hundred percent churn — the worst possible month.
    const catastrophic = scoreRevenueQuality(null, 1, []);
    const excellent = scoreRevenueQuality(null, 0.005, []);

    expect(catastrophic).toBeLessThan(excellent);
  });

  it('scores a measured-but-poor churn below an unknown one', () => {
    // The tell, asserted: an unknown churn takes the stated 1 point. A measured
    // 10% must land below it, not above.
    const unknown = scoreRevenueQuality(null, null, []);
    const terrible = scoreRevenueQuality(null, 0.10, []);

    expect(terrible).toBeLessThan(unknown);
  });
});
