process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { computeUnitEconomics } from '../../src/services/intelligence/business-model.js';
import { projectTAMSaturation } from '../../src/services/intelligence/expansion.js';

// =============================================================================
// A LIFETIME A HUNDRED TIMES TOO LONG, AND ONLY FOR COMPANIES THAT REPORTED.
//
// `metric_snapshots.churn_rate` is stored as a 0–1 FRACTION — the ingest
// validates that range and IMPLEMENTATION_STATE states it. `computeUnitEconomics`
// divided it by 100. Five percent monthly churn became 0.0005, an average
// customer lifetime of 2,000 months, and an LTV inflated a hundredfold, feeding
// the LTV:CAC ratio and CAC payback on the tier3 unit-economics endpoint.
//
// THE TELL IS WHAT THE FALLBACK DID. `?? 5` was written in PERCENT, so the
// fallback path divided correctly and the real-data path did not: a company that
// reported its churn got a worse answer than one that reported nothing. When a
// fallback and the measurement it replaces disagree about the arithmetic that
// follows, one of them is in the wrong unit.
//
// The default is gone with it. Five percent monthly churn assumed for a company
// that never reported any, then compounded into LTV, payback and the ratio, is
// an invented unit-economics model presented as this company's.
//
// AND ARPU FROM A MOVEMENT AGAIN. `totalMRR` was new + expansion - contraction
// - churned — net new MRR — divided by active users. A flat month gave an ARPU
// of zero; a bad month gave a NEGATIVE lifetime value.
//
// The saturation projection had the same shape twice over: it summed new and
// expansion MRR and called it revenue, and answered 99 years for a company with
// fewer than two snapshots and 0 years for one whose TAM could not be
// estimated — the most alarming and the most flattering answers available, both
// for companies nobody had measured.
// =============================================================================

const P = 'p_ue';

vi.mock('../../src/services/ai/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/ai/client.js')>()),
  callOpus: async () => ({
    content: JSON.stringify({ tam_estimate_usd: 100_000_000, methodology: 'stub' }),
    model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: null,
  }),
}));

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ue','c_ue','u@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_ue','active')", [P]);
});
beforeEach(async () => { await query('DELETE FROM metric_snapshots'); });

async function snap(cols: Record<string, number>, daysAgo = 0) {
  const keys = Object.keys(cols);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, ${keys.join(', ')})
     VALUES (?, ?, date('now', ?), ${keys.map(() => '?').join(', ')})`,
    [nanoid(), P, `-${daysAgo} days`, ...keys.map((k) => cols[k]!)]);
}

describe('customer lifetime', () => {
  it('reads churn as the fraction it is stored as', async () => {
    // 5% monthly churn → a twenty-month average lifetime. The lifetime is
    // internal, so it is read through the LTV it produces: ARPU $100, no COGS
    // recorded so the contribution margin is 1, twenty months → $2,000.
    await snap({ mrr_cents: 1_000_000, active_users: 100, churn_rate: 0.05 });
    const e = await computeUnitEconomics(P);
    expect(e).not.toBeNull();
    expect(e!.ltv, 'dividing the fraction by 100 made this $200,000').toBeCloseTo(2000, 2);
  });

  it('no longer rewards a company for reporting nothing', async () => {
    await snap({ mrr_cents: 1_000_000, active_users: 100 });
    expect(await computeUnitEconomics(P),
      'the fallback path used to compute correctly while the real one did not')
      .toBeNull();
  });
});

describe('ARPU in the unit economics', () => {
  it('is the level over the users', async () => {
    await snap({ mrr_cents: 1_000_000, active_users: 100, churn_rate: 0.05, new_mrr_cents: 0 });
    const e = await computeUnitEconomics(P);
    expect(e!.arpu, '$10,000/mo over 100 users; the movement was zero').toBeCloseTo(100, 5);
  });

  it('is not computed at all without a level', async () => {
    await snap({ new_mrr_cents: 500_000, active_users: 100, churn_rate: 0.05 });
    expect(await computeUnitEconomics(P)).toBeNull();
  });
});

describe('years to saturation', () => {
  it('is unknown with fewer than two snapshots', async () => {
    await snap({ mrr_cents: 1_000_000 });
    const s = await projectTAMSaturation(P);
    expect(s.pct_20, '99 years was an answer about a company nobody measured twice').toBeNull();
    expect(s.pct_50).toBeNull();
    expect(s.pct_80).toBeNull();
  });

  it('is unknown when the level was never reported', async () => {
    await snap({ new_mrr_cents: 100_000 }, 0);
    await snap({ new_mrr_cents: 90_000 }, 60);
    expect((await projectTAMSaturation(P)).pct_50).toBeNull();
  });

  it('is a number when there is something to project from', async () => {
    await snap({ mrr_cents: 2_000_000 }, 0);
    await snap({ mrr_cents: 1_000_000 }, 60);
    const s = await projectTAMSaturation(P);
    expect(typeof s.pct_50).toBe('number');
  });
});

describe('the arithmetic that produced them is gone', () => {
  it('no /100 on a fraction, no assumed churn', () => {
    const code = stripComments(
      readFileSync('src/services/intelligence/business-model.ts', 'utf8'), { lineComments: true });
    expect(code).not.toMatch(/churn_rate as number\) \?\? 5/);
    expect(code).not.toMatch(/churnRate \/ 100/);
  });

  it('no movement standing in for the level', () => {
    const econ = stripComments(
      readFileSync('src/services/intelligence/business-model.ts', 'utf8'), { lineComments: true });
    expect(econ).toMatch(/const mrrLevel = m\.mrr_cents == null/);
    const exp = stripComments(
      readFileSync('src/services/intelligence/expansion.ts', 'utf8'), { lineComments: true });
    expect(exp).not.toMatch(/new_mrr_cents \?\? 0\) \+ \(rows/);
  });
});
