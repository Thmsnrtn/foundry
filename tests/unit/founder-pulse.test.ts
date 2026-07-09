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
  for (const id of ['p_steady', 'p_over']) {
    await query(`INSERT INTO products (id, name, owner_id) VALUES ('${id}','Co','o1')`, []);
  }
  // Steady founder: ~3/week for 5 weeks, daytime, mostly approvals.
  for (let d = 1; d <= 33; d += 2) await seedDecision('p_steady', { daysAgo: d });
  // Overloaded founder: light prior month (1/wk), then a 2am-heavy 8-decision week.
  for (const d of [10, 17, 24, 31]) await seedDecision('p_over', { daysAgo: d });
  for (let i = 1; i <= 8; i++) {
    await seedDecision('p_over', { daysAgo: (i % 6) + 1, hour: i <= 4 ? 2 : 23 });
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
