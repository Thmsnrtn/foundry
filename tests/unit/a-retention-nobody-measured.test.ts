process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getHistoricalAverage, getLatestCohortSummary, getCohortsByChannel,
} from '../../src/services/intelligence/cohort.js';

// =============================================================================
// A RETENTION NOBODY MEASURED, RENDERED AS ZERO.
//
// `cohorts` has ten outcome columns — activation, retention at 7/14/30/60/90
// days, conversions, churn, MRR contribution — and NOTHING IN THIS CODEBASE
// WRITES ANY OF THEM. The only production writer of the table is the Clerk
// signup webhook, incrementing `founder_count` on FOUNDRY'S OWN product.
//
// Every one of those columns was `INTEGER DEFAULT 0`, so six readers took the
// default as a measurement: the cohorts page drew "0%" at day 7, 14 and 30
// beside a historical average of the same zeros; the API returned it as JSON;
// Harbor's prompt told a model "activation=0.0%, day30_retention=0.0%" for each
// cohort; Beacon RANKED acquisition channels by an activation rate that was
// zero for all of them; and the retention stressor compared a cohort against an
// average pulled towards zero by every unreported cohort in it.
//
// Migration 212 removes the defaults, the same repair as migration 202: absent
// means absent. It does not make retention measurable — that gap is the owner's
// to close, and it is written down rather than papered over.
// =============================================================================

const P = 'p_coh';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_coh','c_coh','coh@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_coh','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM cohorts'); });

async function cohort(id: string, period: string, opts: {
  channel?: string; founders?: number;
  d7?: number | null; d14?: number | null; d30?: number | null;
} = {}) {
  await query(
    `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel,
       founder_count, retained_day_7, retained_day_14, retained_day_30)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, P, period, opts.channel ?? 'organic', opts.founders ?? 100,
     opts.d7 ?? null, opts.d14 ?? null, opts.d30 ?? null],
  );
}

describe('the columns', () => {
  it('store NULL when an insert does not mention them', async () => {
    await query(
      `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count)
       VALUES ('c_1', ?, '2026-01-01', 'organic', 50)`, [P]);
    const row = (await query("SELECT * FROM cohorts WHERE id='c_1'"))
      .rows[0] as unknown as Record<string, unknown>;
    for (const col of ['activated_count', 'retained_day_7', 'retained_day_14',
      'retained_day_30', 'retained_day_60', 'retained_day_90',
      'converted_to_paid', 'churned_count', 'mrr_contribution_cents']) {
      expect(row[col], `${col} still defaults to a number`).toBeNull();
    }
    // The one thing something does write keeps its default.
    expect(row.founder_count).toBe(50);
  });
});

describe('the historical average', () => {
  it('is not dragged towards zero by cohorts that reported nothing', async () => {
    await cohort('c_1', '2026-01-01', { d14: 40 });   // 40%
    await cohort('c_2', '2026-02-01', { d14: 60 });   // 60%
    await cohort('c_3', '2026-03-01');                // nothing reported

    const avg = await getHistoricalAverage(P);
    expect(avg?.day_14).toBeCloseTo(50, 6);
    // Counting the third as a zero gave 33.3.
    expect(avg?.day_14).not.toBeCloseTo(33.3, 1);
  });

  it('counts each horizon separately', async () => {
    await cohort('c_1', '2026-01-01', { d7: 80, d14: 40 });
    await cohort('c_2', '2026-02-01', { d7: 60 });

    const avg = await getHistoricalAverage(P);
    expect(avg?.day_7).toBeCloseTo(70, 6);
    expect(avg?.day_14).toBeCloseTo(40, 6);
    expect(avg?.day_30).toBeNull();
  });

  it('is null when nothing was reported at all', async () => {
    await cohort('c_1', '2026-01-01');
    await cohort('c_2', '2026-02-01');
    expect(await getHistoricalAverage(P)).toBeNull();
  });
});

describe('the latest cohort summary', () => {
  it('says the retention is unmeasured rather than zero', async () => {
    await cohort('c_1', '2026-01-01', { d14: 40 });
    await cohort('c_2', '2026-02-01', { d14: 60 });
    await cohort('c_3', '2026-03-01');

    const summary = await getLatestCohortSummary(P);
    expect(summary?.period).toBe('2026-03-01');
    expect(summary?.retention_day_14).toBeNull();
    // No figure means no comparison — this used to be a full-average gap, and
    // the stressor engine raised "Severe cohort retention drop" from it.
    expect(summary?.vs_historical_average_14).toBeNull();
  });

  it('compares a reported cohort against the average', async () => {
    await cohort('c_1', '2026-01-01', { d14: 60 });
    await cohort('c_2', '2026-02-01', { d14: 40 });
    const summary = await getLatestCohortSummary(P);
    expect(summary?.retention_day_14).toBeCloseTo(40, 6);
    expect(summary?.vs_historical_average_14).toBeCloseTo(-10, 6);  // avg 50
  });

  it('leaves a comparison null when the average has no figure for that day', async () => {
    await cohort('c_1', '2026-01-01', { d14: 60 });
    await cohort('c_2', '2026-02-01', { d14: 40, d30: 20 });
    const summary = await getLatestCohortSummary(P);
    expect(summary?.retention_day_30).toBeCloseTo(20, 6);
    expect(summary?.vs_historical_average_30, 'one cohort reported day 30; that is the average')
      .toBeCloseTo(0, 6);
  });
});

describe('what the agents are told', () => {
  it('Harbor does not state an unreported figure as a percentage', () => {
    const src = stripComments(readFileSync('src/services/scp/agents/harbor.ts', 'utf8'));
    expect(src).not.toContain('Number(c.activated_count) || 0');
    expect(src).not.toContain('Number(c.retained_day_30) || 0');
    expect(src).toContain("return 'not reported'");
  });

  it('Beacon ranks the channels that have a rate ahead of those that do not', () => {
    const src = stripComments(readFileSync('src/services/scp/agents/beacon.ts', 'utf8'));
    expect(src).toContain('ORDER BY avg_activation IS NULL, avg_activation DESC');
  });

  it('and a channel with no retention figure says so rather than scoring 0', async () => {
    await cohort('c_1', '2026-01-01', { channel: 'paid' });
    const byChannel = await getCohortsByChannel(P);
    expect(byChannel.paid.avgRetention14).toBeNull();
  });
});

describe('what is sold', () => {
  const gate = readFileSync('src/middleware/tier-gate.ts', 'utf8');
  const landing = readFileSync('src/routes/public/landing.ts', 'utf8');

  it('no longer promises retention curves nothing can produce', () => {
    expect(gate).not.toContain('Day 7, 14, 30, 60, 90 retention by acquisition period and channel');
    expect(gate).not.toContain('Which acquisition source retains best?');
    expect(gate).toContain('Foundry has no path for reporting cohort retention today');
  });

  it('and the pricing page does not list it as a capability', () => {
    expect(landing).not.toContain('Cohort analysis + competitive intelligence');
  });
});
