process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getCohortsByChannel, getHistoricalAverage, getLatestCohortSummary,
} from '../../src/services/intelligence/cohort.js';
import { identifyStressors } from '../../src/services/intelligence/stressor.js';
import type { StressorInputs } from '../../src/services/intelligence/stressor.js';

// =============================================================================
// EXACTLY AT AN AVERAGE THAT DOES NOT EXIST.
//
// `vs_historical_average_14` is how many points above or below the historical
// average the latest cohort sits. It was `avg ? (latest - avg.day_14) : 0`, and
// zero in that field is not a neutral value — it is the specific claim "exactly
// at the average". A company needs at least two cohorts before an average
// exists, so EVERY COMPANY, at first, was told it was performing precisely at
// an average Foundry had never computed. It reaches the founder through the
// digest's evaluation context and the stressor report.
//
// AND A COHORT WITH NOBODY IN IT HAD A RETENTION OF 0%. `founder_count > 0 ? …
// : 0` looks defensive and is not: `stressor.ts` subtracts that figure from the
// historical average, so an empty cohort row produced a full-average gap and
// raised "Severe cohort retention drop" at CRITICAL severity — about a cohort
// that had no one to retain. The stressor guarded the average and not the
// cohort's own number.
//
// The channel breakdown did the same thing one level up, rendering "0%" beside
// a channel whose cohorts were all empty — a verdict on the channel rather than
// an absence of one.
// =============================================================================

const P = 'p_coh';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_c2','c_c2','c2@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_c2','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM cohorts WHERE product_id = ?', [P]); });

async function cohort(period: string, opts: {
  founders: number; day14?: number; day30?: number; day7?: number; channel?: string;
}): Promise<void> {
  await query(
    `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel,
       founder_count, retained_day_7, retained_day_14, retained_day_30)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), P, period, opts.channel ?? 'organic', opts.founders,
     opts.day7 ?? 0, opts.day14 ?? 0, opts.day30 ?? 0]);
}

describe('a company with one cohort', () => {
  it('is not told it is exactly at the average', async () => {
    await cohort('2026-01', { founders: 100, day14: 60, day30: 40 });

    const summary = await getLatestCohortSummary(P);

    expect(summary!.retention_day_14).toBeCloseTo(60, 6);
    // Zero here would say "precisely average". There is no average.
    expect(summary!.vs_historical_average_14).toBeNull();
    expect(summary!.vs_historical_average_30).toBeNull();
    expect(await getHistoricalAverage(P)).toBeNull();
  });

  it('compares once there is something to compare against', async () => {
    await cohort('2026-01', { founders: 100, day14: 40, day30: 20 });
    await cohort('2026-02', { founders: 100, day14: 60, day30: 40 });

    const summary = await getLatestCohortSummary(P);

    // Average over both cohorts is 50; the latest is 60.
    expect(summary!.vs_historical_average_14).toBeCloseTo(10, 6);
  });
});

describe('a cohort with nobody in it', () => {
  it('has no retention rather than none of it', async () => {
    await cohort('2026-03', { founders: 0 });

    const summary = await getLatestCohortSummary(P);

    expect(summary!.retention_day_14).toBeNull();
    expect(summary!.retention_day_30).toBeNull();
  });

  it('cannot be compared to an average either', async () => {
    await cohort('2026-01', { founders: 100, day14: 40 });
    await cohort('2026-02', { founders: 100, day14: 60 });
    await cohort('2026-03', { founders: 0 });

    const summary = await getLatestCohortSummary(P);

    // The average exists; the cohort's own figure does not.
    expect(await getHistoricalAverage(P)).not.toBeNull();
    expect(summary!.retention_day_14).toBeNull();
    expect(summary!.vs_historical_average_14).toBeNull();
  });

  it('is left out of the historical average rather than dragging it to zero', async () => {
    await cohort('2026-01', { founders: 100, day7: 80, day14: 60, day30: 40 });
    await cohort('2026-02', { founders: 100, day7: 80, day14: 60, day30: 40 });
    await cohort('2026-03', { founders: 0 });

    const avg = await getHistoricalAverage(P);

    expect(avg!.day_14).toBeCloseTo(60, 6);
  });
});

describe('the channel breakdown', () => {
  it('reports no retention for a channel whose cohorts were all empty', async () => {
    await cohort('2026-01', { founders: 0, channel: 'billboards' });
    await cohort('2026-02', { founders: 50, day14: 30, channel: 'organic' });

    const byChannel = await getCohortsByChannel(P);

    // "0%" beside a channel name is a verdict on the channel.
    expect(byChannel.billboards!.avgRetention14).toBeNull();
    expect(byChannel.organic!.avgRetention14).toBeCloseTo(60, 6);
  });
});

describe('what the empty cohort used to raise', () => {
  const base = (latestCohort: StressorInputs['latestCohort']): StressorInputs => ({
    productId: P,
    currentMetrics: null,
    priorMetrics: null,
    mrrDecomposition: null,
    latestCohort,
    // A real average, computed from real cohorts. This half was always guarded.
    historicalAvgRetention: { day_14: 60, day_30: 40 },
    highSignificanceSignals: [],
    riskState: 'green',
  });

  it('raises no retention stressor about a cohort with nobody in it', async () => {
    await cohort('2026-03', { founders: 0 });
    const summary = await getLatestCohortSummary(P);

    const report = await identifyStressors(base(summary));

    // The old figure was a substituted 0, so `60 - 0` was a sixty-point gap and
    // this came back as "Severe cohort retention drop", severity critical.
    expect(report.stressors.filter((s2) => /cohort retention/i.test(s2.name))).toEqual([]);
  });

  it('still raises one when a real cohort really did drop', async () => {
    await cohort('2026-04', { founders: 100, day14: 10 });
    const summary = await getLatestCohortSummary(P);

    const report = await identifyStressors(base(summary));

    const drop = report.stressors.find((s2) => /cohort retention/i.test(s2.name));
    expect(drop).toBeDefined();
    expect(drop!.signal).toContain('10.0%');
  });

  it('reports no comparison in the evaluation context rather than zero', async () => {
    await cohort('2026-05', { founders: 100, day14: 60 });
    const summary = await getLatestCohortSummary(P);

    const report = await identifyStressors(base(summary));

    // One cohort, so there is no average — and this field is what the digest
    // and the model are handed.
    expect(report.evaluation_context.latest_cohort_retention_vs_avg).toBeNull();
  });
});
