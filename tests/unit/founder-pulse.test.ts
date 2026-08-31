// =============================================================================
// Tests: Founder pulse (Ascent B5 / Human Law)
// Strain is computed only from real decision telemetry; the message always
// shows its numbers; steady weeks stay silent.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getFounderPulse } from '../../src/services/wellbeing/pulse.js';

let seq = 0;
async function seedDecision(productId: string, opts: {
  daysAgo: number; hour?: number; status?: string;
}): Promise<void> {
  const hour = String(opts.hour ?? 14).padStart(2, '0');
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at)
     VALUES (?, ?, 'strategic', 1, 'x', 'y', ?, 'founder',
             datetime(datetime('now', ?), 'start of day', ?))`,
    [`fp${++seq}`, productId, opts.status ?? 'approved', `-${opts.daysAgo} days`, `+${hour} hours`],
  );
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  // THE FOUNDER SAID WHERE THEY ARE. `decided_at` is UTC, and the late-night
  // window is a claim about the founder's own clock ("between 11pm and 5am"),
  // so it can only be computed for a founder who stated a timezone. These
  // fixtures seed UTC hours, so the owner states UTC and the two agree.
  // `p_nowhere` states nothing, which is the ordinary case and the one the
  // pulse must refuse to guess at.
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, preferences)
     VALUES ('o1','c_o1','o1@example.com', ?)`, [JSON.stringify({ timezone: 'UTC' })]);
  await query(
    `INSERT INTO founders (id, clerk_user_id, email) VALUES ('o2','c_o2','o2@example.com')`);
  for (const id of ['p_steady', 'p_over']) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('${id}','Co','o1')`, []);
  }
  await query(`INSERT INTO products (id, name, owner_id) VALUES ('p_nowhere','Co','o2')`, []);
  // Steady founder: ~3/week for 5 weeks, daytime, mostly approvals.
  for (let d = 1; d <= 33; d += 2) await seedDecision('p_steady', { daysAgo: d });
  // Overloaded founder: light prior month (1/wk), then a 2am-heavy 8-decision week.
  for (const d of [10, 17, 24, 31]) await seedDecision('p_over', { daysAgo: d });
  for (let i = 1; i <= 8; i++) {
    await seedDecision('p_over', { daysAgo: (i % 6) + 1, hour: i <= 4 ? 2 : 23 });
  }
  // Same week, same hours, a founder who never said where they are.
  for (const d of [10, 17, 24, 31]) await seedDecision('p_nowhere', { daysAgo: d });
  for (let i = 1; i <= 8; i++) {
    await seedDecision('p_nowhere', { daysAgo: (i % 6) + 1, hour: i <= 4 ? 2 : 23 });
  }
});

describe('founder pulse', () => {
  it('reads steady for a steady week and stays quiet', async () => {
    const p = await getFounderPulse('p_steady');
    expect(p.signal).toBe('steady');
    expect(p.message).toContain('steady');
  });

  it('flags overload from load spike + late-night share, with the numbers shown', async () => {
    const p = await getFounderPulse('p_over');
    expect(p.decisions7d).toBeGreaterThanOrEqual(6);
    expect(p.loadRatio).toBeGreaterThanOrEqual(2);
    expect(p.lateNightShare).toBeGreaterThanOrEqual(0.4);
    expect(p.signal).toBe('overloaded');
    expect(p.message).toMatch(/\d+ decisions this week/);
    expect(p.message).toMatch(/11pm and 5am/);
    expect(p.message).toContain('the queue will keep');
  });

  it('handles a product with no decisions at all (no baseline, no strain)', async () => {
    await query("INSERT INTO products (id, name, owner_id) VALUES ('p_empty','Co','o1')", []);
    const p = await getFounderPulse('p_empty');
    expect(p.signal).toBe('steady');
    expect(p.loadRatio).toBeNull();
  });
});

describe('whose eleven o\'clock', () => {
  // This counted the UTC hour of `decided_at` and then told the founder the
  // number was "between 11pm and 5am" — their clock. For a US-Pacific founder,
  // 4pm to 10pm local IS 23:00–04:59 UTC, so an ordinary working evening scored
  // a late-night share of 1.0 and Foundry said, in a message about their life,
  // that every decision was made in the middle of the night. It also fed
  // `strain`, and an overloaded pulse drops every non-critical event two rungs
  // down the interruption ladder — Foundry quieting itself on a mis-measured
  // fact, then sending a note explaining why.

  it('says nothing about a founder\'s nights when they never said where they are', async () => {
    const p = await getFounderPulse('p_nowhere');

    expect(p.decisions7d).toBeGreaterThanOrEqual(6);
    expect(p.lateNightShare).toBeNull();
    expect(p.message).not.toMatch(/11pm and 5am/);
  });

  it('does not let an unmeasurable factor add strain', async () => {
    const stated = await getFounderPulse('p_over');
    const unstated = await getFounderPulse('p_nowhere');

    // Identical decision telemetry. The only difference is whether Foundry can
    // place the hours on the founder's clock — so the one it cannot place must
    // score one strain factor lower, not the same.
    expect(stated.signal).toBe('overloaded');
    expect(unstated.signal).toBe('strained');
  });

  it('counts the hour on the founder\'s clock, not the server\'s', async () => {
    // Same eight decisions at 02:00 and 23:00 UTC, read from Los Angeles:
    // 19:00 and 16:00 the previous day. An ordinary working evening.
    await query(
      `UPDATE founders SET preferences = ? WHERE id = 'o1'`,
      [JSON.stringify({ timezone: 'America/Los_Angeles' })]);

    const p = await getFounderPulse('p_over');

    expect(p.lateNightShare).toBe(0);
    expect(p.message).not.toMatch(/11pm and 5am/);

    await query(`UPDATE founders SET preferences = ? WHERE id = 'o1'`,
      [JSON.stringify({ timezone: 'UTC' })]);
  });
});
