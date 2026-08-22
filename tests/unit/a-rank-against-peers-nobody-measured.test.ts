process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { scoreRevenueQuality } from '../../src/services/scp/exit/ma-readiness.js';
import {
  BENCHMARK_METRICS, fmtMetricValue, percentileLabel, rankAgainstPeers,
} from '../../src/routes/dashboard/benchmarks.js';

// =============================================================================
// A RANK AGAINST PEERS NOBODY MEASURED, AND A CHURN CHECK THAT COULD NOT FAIL.
//
// Two surviving readers of the same units rule, in the two places a founder is
// told how they compare.
//
// `metric_snapshots.churn_rate` and `.activation_rate` are 0–1 FRACTIONS. The
// ingest validator pins it — `z.number().min(0).max(1)` — and every other
// surface converts with `* 100`. `services/ai/measured.ts` exists for exactly
// this and carries the explanation. Two readers had not been converted:
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
//   • The benchmarks page declared every metric `unit: '%'` and printed
//     `value.toFixed(1) + '%'`, so a 65% activation rate read "0.7%" and 5%
//     churn read "0.1%", with the peer band collapsing to "0.0% / 0.1% / 0.1%".
//
// AND THE VERDICT DID NOT NEED A VALUE. `yourPercentile` started at 50 and
// stayed there when the company had not reported the metric, and
// `percentileLabel(50, …)` returns 'Above median' in both directions. A founder
// whose churn had never been recorded read "Churn Rate — · Above median · vs 40
// companies": the value column honestly blank, the verdict beside it claiming
// they beat forty peers on a number Foundry has never seen. A rank against peers
// is a finding, and a finding needs something to find it from.
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

describe('the benchmarks page', () => {
  it('renders a stored fraction as percentage points', () => {
    // 0.65 is sixty-five percent. It read "0.7%".
    expect(fmtMetricValue(0.65, 'fraction')).toBe('65.0%');
    expect(fmtMetricValue(0.05, 'fraction')).toBe('5.0%');
    expect(fmtMetricValue(null, 'fraction')).toBe('—');
  });

  it('returns no rank when the company never reported the metric', () => {
    expect(rankAgainstPeers(null, 0.02, 0.05, 0.09, false)).toBeNull();
  });

  it('returns no rank when the pool has no bands to compare against', () => {
    expect(rankAgainstPeers(0.03, null, null, null, false)).toBeNull();
  });

  it('still ranks a company that did report, in both directions', () => {
    // Lower is better: 1% churn against bands of 2/5/9 is the top quartile.
    expect(rankAgainstPeers(0.01, 0.02, 0.05, 0.09, false)).toBe(80);
    expect(rankAgainstPeers(0.12, 0.02, 0.05, 0.09, false)).toBe(15);
    // Higher is better: 80% activation against 30/50/70.
    expect(rankAgainstPeers(0.8, 0.3, 0.5, 0.7, true)).toBe(80);
    expect(rankAgainstPeers(0.2, 0.3, 0.5, 0.7, true)).toBe(15);
  });

  it('is why the old default said the flattering thing in both directions', () => {
    // The verdict function itself is unchanged and correct; the defect was
    // calling it with a substituted 50. Pinned so the shape stays visible.
    expect(percentileLabel(50, true).label).toBe('Above median');
    expect(percentileLabel(50, false).label).toBe('Above median');
  });

  it('lists only metrics this page can actually read and compare', () => {
    // MRR growth rate and NRR are not columns on metric_snapshots at all, and
    // CAC payback lives on business_model_profile, which this page never reads.
    // None of the three is ever submitted to the benchmark pool either, so no
    // peer band could exist. Three permanently empty cards on a page whose whole
    // purpose is comparison is a claim to benchmark what Foundry does not.
    expect(BENCHMARK_METRICS.map((m) => m.key)).toEqual(['churn_rate', 'activation_rate']);
    // And every one declares the unit its COLUMN is in, not the one the card
    // prints, which is what stops the next metric inheriting a '%' that lies.
    expect(BENCHMARK_METRICS.every((m) => m.stored === 'fraction')).toBe(true);
  });
});
