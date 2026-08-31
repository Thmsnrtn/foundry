process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getGrowthSignals } from '../../src/services/founder/intelligence.js';

// =============================================================================
// TWO LABELS, ONE NUMBER.
//
// The operator's Growth Signals card printed "Activation Rate" and
// "Trial → Paid" beside each other as two measurements. They were the same
// expression:
//
//     activation_rate:    total > 0 ? Math.round((paid / total) * 100) : 0,
//     trial_to_paid_rate: total > 0 ? Math.round((paid / total) * 100) : 0,
//
// Two numbers that can never disagree are one number, and a reader comparing
// them learns nothing while believing they have corroborated something.
//
// Neither was its label. Nothing in this system records a founder activating,
// so there is no activation to rate; and a trial conversion whose denominator
// includes founders who never trialed is not a conversion rate — the column
// that makes the real one computable, `trial_ends_at`, had been sitting in
// `founders` since migration 077 and nothing here read it.
//
// Beside them: `expansion_revenue: 0`, which is not a measured absence of
// expansion — no tier change is recorded anywhere, so it cannot be derived at
// all — and `top_acquisition_channels: []`, an empty list that read as "we
// looked and found no channels" while `referred_by_code` (migration 073) held
// the one attribution fact signup actually captures.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => { await query('DELETE FROM founders'); });

let seq = 0;
async function addFounder(opts: {
  tier?: string | null; trialed?: boolean; referred?: boolean;
}): Promise<void> {
  const id = `f_${++seq}`;
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, tier, trial_ends_at, referred_by_code)
     VALUES (?,?,?,?,?,?)`,
    [id, `clerk_${id}`, `${id}@example.com`, opts.tier ?? null,
      opts.trialed ? '2026-01-01' : null, opts.referred ? 'CODE1' : null]);
}

describe('an empty table is not a measurement', () => {
  it('reports unknown rates rather than zero ones', async () => {
    const g = await getGrowthSignals();
    expect(g.paid_share_pct, 'no founders is not 0% of founders').toBeNull();
    expect(g.trial_to_paid_rate, 'nobody trialed is not a 0% conversion').toBeNull();
  });

  it('names no acquisition channels when nobody has arrived', async () => {
    const g = await getGrowthSignals();
    expect(g.top_acquisition_channels).toEqual([]);
  });

  it('still counts signups as real zeroes, because a count over nothing is zero', async () => {
    const g = await getGrowthSignals();
    expect(g.new_signups_7d).toBe(0);
    expect(g.new_signups_30d).toBe(0);
  });
});

describe('the two rates are two different questions', () => {
  it('disagree on data where they should, which the old pair could not', async () => {
    // Four founders. Two trialed; of those, one pays. One more pays without
    // ever having trialed. Paid share is 2/4; trial conversion is 1/2.
    await addFounder({ trialed: true, tier: 'growth' });
    await addFounder({ trialed: true });
    await addFounder({ tier: 'scale' });
    await addFounder({});

    const g = await getGrowthSignals();
    expect(g.paid_share_pct).toBe(50);
    expect(g.trial_to_paid_rate).toBe(50);

    // Now add two more trialers who did not convert: the trial rate moves, the
    // paid share moves differently. One expression could not do this.
    await addFounder({ trialed: true });
    await addFounder({ trialed: true });
    const after = await getGrowthSignals();
    expect(after.paid_share_pct).toBe(33);
    expect(after.trial_to_paid_rate).toBe(25);
    expect(after.paid_share_pct).not.toBe(after.trial_to_paid_rate);
  });

  it('denominates trial conversion on trialers, not on everyone', async () => {
    await addFounder({ trialed: true, tier: 'growth' });
    for (let i = 0; i < 9; i++) await addFounder({});

    const g = await getGrowthSignals();
    expect(g.trial_to_paid_rate, 'one trialer, who converted').toBe(100);
    expect(g.paid_share_pct, 'one of ten founders pays').toBe(10);
  });

  it('holds no second copy of the paid-share expression', () => {
    const src = stripComments(
      readFileSync('src/services/founder/intelligence.ts', 'utf8'), { lineComments: true });
    expect(src, 'an activation rate needs an activation event, and there is none')
      .not.toMatch(/activation_rate/);
  });
});

describe('what cannot be derived is not reported as zero', () => {
  it('leaves expansion revenue unmeasured', async () => {
    await addFounder({ tier: 'growth' });
    const g = await getGrowthSignals();
    expect(g.expansion_revenue, 'no tier change is recorded anywhere').toBeNull();
  });

  it('has no tier-change history to derive it from', async () => {
    const tables = await query(
      `SELECT name FROM sqlite_master WHERE type='table'
         AND (name LIKE '%tier%' OR name LIKE '%subscription_history%')`);
    expect(tables.rows.length,
      'if this ever fails, expansion became computable and should be computed').toBe(0);
  });
});

describe('acquisition channels report the one fact signup records', () => {
  it('splits referred from unattributed, largest first', async () => {
    await addFounder({ referred: true });
    await addFounder({});
    await addFounder({});

    const g = await getGrowthSignals();
    expect(g.top_acquisition_channels).toEqual([
      { channel: 'unattributed', count: 2 },
      { channel: 'referral', count: 1 },
    ]);
  });

  it('does not call an unrecorded route a direct one', async () => {
    await addFounder({});
    const g = await getGrowthSignals();
    expect(g.top_acquisition_channels.map((c) => c.channel)).not.toContain('direct');
    expect(g.top_acquisition_channels).toEqual([{ channel: 'unattributed', count: 1 }]);
  });

  it('omits a channel nobody used rather than listing it at zero', async () => {
    await addFounder({ referred: true });
    const g = await getGrowthSignals();
    expect(g.top_acquisition_channels).toEqual([{ channel: 'referral', count: 1 }]);
  });
});

describe('the page the operator reads', () => {
  it('prints why a rate is missing instead of printing 0%', () => {
    const src = readFileSync('src/routes/dashboard/founder-ops.ts', 'utf8');
    expect(src).toMatch(/no founders yet/);
    expect(src).toMatch(/nobody has trialed/);
    expect(stripComments(src, { lineComments: true }),
      'the badge that was always equal to the one beside it').not.toMatch(/Activation Rate/);
  });
});
