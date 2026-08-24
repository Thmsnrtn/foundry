process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { execSync } from 'node:child_process';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { ratePoints } from '../../src/services/ai/measured.js';

// =============================================================================
// A FRACTION COMPARED AGAINST A PERCENTAGE.
//
// `activation_rate`, `churn_rate`, `day_30_retention` and `mrr_health_ratio`
// are stored as 0–1 fractions. The ingest endpoint validates that range and
// `ux/fluency.ts` names them as fractions in so many words. Five readers
// treated them as percentage points.
//
// The failure is silent in a particular way, and that is the part worth
// carrying: every "higher is better" test fails (`0.68 >= 40`) and every "lower
// is better" test passes (`0.02 <= 3`). So a company scored ZERO for excellent
// retention and FULL MARKS for catastrophic churn, and nothing looked broken
// from either side.
//
// Concretely, in `scp/investor/fundraising-readiness.ts`: six of the ten points
// in `scoreTraction` were unreachable by any company — growth, customers and
// retention — while churn always awarded its two whatever the number. And two
// of those three were unreachable for a second reason: `mrr_growth_pct` and
// `customer_count` ARE NOT COLUMNS on `metric_snapshots`, read off a `SELECT *`
// row and `undefined` forever. `d30_retention` is not a column either; the real
// one is `day_30_retention`, sitting there with the data in it.
//
// In `network/failure-library.ts`, `match_criteria: { churn_rate_gt: 8 }` means
// eight per cent, so no failure pattern keyed on churn could match for any
// company — the library kept matching on its other criteria and simply never
// fired on that one.
//
// And in the briefings and the investor update, a company churning 2% a month
// was told, in writing, that its churn was 0.0%.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

describe('the convention, stated once', () => {
  it('converts a stored fraction to percentage points', () => {
    expect(ratePoints(0.68)).toBeCloseTo(68, 6);
    expect(ratePoints(0.02)).toBeCloseTo(2, 6);
    expect(ratePoints(0), 'a recorded zero is zero per cent').toBe(0);
  });

  it('keeps unknown unknown', () => {
    expect(ratePoints(null)).toBeNull();
    expect(ratePoints(undefined)).toBeNull();
    expect(ratePoints('not a number')).toBeNull();
  });
});

describe('the columns that were never there', () => {
  const columnsOf = (table: string): Set<string> => {
    const db = `/tmp/_units_${process.pid}.db`;
    execSync(`rm -f ${db}`);
    const files = execSync('ls src/db/migrations/*.sql | sort').toString().trim().split('\n');
    for (const f of files) {
      try { execSync(`sqlite3 ${db} < ${f} 2>/dev/null`); } catch { /* later migrations may not apply standalone */ }
    }
    const out = execSync(`sqlite3 ${db} "PRAGMA table_info('${table}')"`).toString();
    execSync(`rm -f ${db}`);
    return new Set(out.trim().split('\n').map((l) => l.split('|')[1]).filter(Boolean));
  };

  it('confirms mrr_growth_pct, customer_count and d30_retention do not exist', () => {
    const cols = columnsOf('metric_snapshots');
    expect(cols.size, 'the schema built at all').toBeGreaterThan(10);
    for (const ghost of ['mrr_growth_pct', 'customer_count', 'd30_retention']) {
      expect(cols.has(ghost), `${ghost} was read off a SELECT * row`).toBe(false);
    }
    expect(cols.has('day_30_retention'), 'the real one, with the data in it').toBe(true);
  });

  it('is no longer read from the snapshot row', () => {
    const src = stripComments(
      readFileSync('src/services/scp/investor/fundraising-readiness.ts', 'utf8'),
      { lineComments: true });
    expect(src).not.toMatch(/metricsRow\.mrr_growth_pct/);
    expect(src).not.toMatch(/metricsRow\.customer_count/);
    expect(src).not.toMatch(/metricsRow\.d30_retention/);
    // The SUBJECT here is that growth comes from two snapshots of the LEVEL
    // rather than from a column that does not exist. It used to pin the exact
    // expression `((now - then) / then) * 100`, which turned red when the rate
    // was made monthly-equivalent — a correction to a different defect in the
    // same line. Pin the two levels and the fact that the gap between their
    // dates is what the rate is expressed over.
    expect(src, 'growth is computed from two snapshots of the level')
      .toMatch(/mrrGrowthPct = \(\(now \/ then\)/);
    expect(src, 'and over the interval those two snapshots actually span')
      .toMatch(/30\.44 \/ gapDays/);
    expect(src, 'and customers are counted where they live')
      .toMatch(/getCompanyCustomers/);
  });
});

describe('a company doing well is scored as doing well', () => {
  async function score(opts: {
    mrrCents: number; priorMrrCents?: number; churn: number; retention: number; activation: number;
  }) {
    const owner = `f_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [owner, `c_${owner}`, `${owner}@example.com`]);
    const pid = `p_${nanoid(8)}`;
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
      [pid, 'C', owner]);
    if (opts.priorMrrCents !== undefined) {
      await query(
        `INSERT INTO metric_snapshots
           (id, product_id, snapshot_date, mrr_cents) VALUES (?,?, date('now','-30 days'), ?)`,
        [nanoid(), pid, opts.priorMrrCents]);
    }
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, mrr_cents, churn_rate, day_30_retention, activation_rate)
       VALUES (?,?, date('now'), ?,?,?,?)`,
      [nanoid(), pid, opts.mrrCents, opts.churn, opts.retention, opts.activation]);

    const { assessFundraisingReadiness } = await import(
      '../../src/services/scp/investor/fundraising-readiness.js');
    return assessFundraisingReadiness(pid, 'seed');
  }

  it('awards retention and growth points that were unreachable', async () => {
    const strong = await score({
      mrrCents: 3_000_000, priorMrrCents: 2_000_000,
      churn: 0.01, retention: 0.68, activation: 0.45,
    });
    // 50% growth, 68% retention, 1% churn, $30k MRR — a strong seed profile.
    expect(strong.scores.traction, 'six of ten points used to be unreachable')
      .toBeGreaterThan(4);
  });

  it('does not award full churn marks to catastrophic churn', async () => {
    const good = await score({ mrrCents: 3_000_000, churn: 0.01, retention: 0.6, activation: 0.4 });
    const awful = await score({ mrrCents: 3_000_000, churn: 0.35, retention: 0.6, activation: 0.4 });
    expect(awful.scores.traction, '35% monthly churn used to score the same as 1%')
      .toBeLessThan(good.scores.traction);
  });

  it('separates a good activation rate from a poor one', async () => {
    const good = await score({ mrrCents: 100, churn: 0.02, retention: 0.5, activation: 0.55 });
    const poor = await score({ mrrCents: 100, churn: 0.02, retention: 0.5, activation: 0.05 });
    expect(good.scores.unit_economics, 'every company used to score the same here')
      .toBeGreaterThan(poor.scores.unit_economics);
  });
});

describe('what a person is shown', () => {
  it('renders a fraction as the percentage it is', () => {
    for (const f of ['src/services/scp/briefing/compressed.ts',
                     'src/services/scp/briefing/email-digest.ts']) {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(src, `${f}: 2% churn was reaching a founder as "0.0%"`)
        .toMatch(/churn_rate as number\) \* 100/);
      expect(src).toMatch(/activation_rate as number\) \* 100/);
    }
  });

  it('does not send an investor update saying 0.0% churn', () => {
    const src = stripComments(
      readFileSync('src/services/scp/investor/investor-update.ts', 'utf8'),
      { lineComments: true });
    expect(src).toMatch(/Number\(metricsRow\.churn_rate\) \* 100/);
    expect(src).toMatch(/Number\(metricsRow\.activation_rate\) \* 100/);
  });
});

describe('a failure pattern keyed on churn can fire', () => {
  it('compares points against points', () => {
    const src = stripComments(
      readFileSync('src/services/network/failure-library.ts', 'utf8'), { lineComments: true });
    expect(src, 'churn_rate_gt: 8 means eight per cent').toMatch(/ratePoints\(latest\?\.churn_rate\)/);
    expect(src).toMatch(/ratePoints\(latest\?\.activation_rate\)/);
    expect(src, 'nps runs -100..100 already and must not be scaled')
      .toMatch(/nps_score: \(latest\?\.nps_score as number \| null\) \?\? null/);
  });
});
