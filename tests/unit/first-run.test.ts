// =============================================================================
// Tests: First-run honesty (product refinement, 2026-07-14)
// A brand-new founder must not be told "quiet day, go rest" or shown a
// falsely-confident Signal. Empty ≠ established-and-calm; no data ≠ healthy.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { composeLetter } from '../../src/services/letter/composer.js';
import { computeSignal } from '../../src/services/signal.js';

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('fr_new','FreshCo','fr_o','active')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('fr_est','EstCo','fr_o','active')", []);
  // Established product: has a metric snapshot (history exists).
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate, activation_rate)
     VALUES (?, 'fr_est', date('now'), 0.04, 0.5)`, [nanoid()],
  );
});

describe('the brand-new founder', () => {
  it('gets a first-run Letter, not "quiet day, go rest"', async () => {
    const letter = await composeLetter('fr_new', 'plain');
    expect(letter.firstRun).toBe(true);   // welcome + orient, not the rest state
    expect(letter.quiet).toBe(true);      // still structurally empty
  });

  it('sees an honest "no data yet" Signal, not a confident 80', async () => {
    const signal = await computeSignal('fr_new');
    expect(signal.hasData).toBe(false);   // the surface must abstain, not assert
  });
});

describe('the established product on a calm day is NOT first-run', () => {
  it('has history, so a quiet Letter reads as "quiet", not "welcome"', async () => {
    const letter = await composeLetter('fr_est', 'plain');
    expect(letter.firstRun).toBe(false);  // established — the rest state is honest here
    const signal = await computeSignal('fr_est');
    expect(signal.hasData).toBe(true);    // it has real metrics
  });
});
