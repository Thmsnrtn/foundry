process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getIntegrationHealth } from '../../src/services/integrations/health-monitor.js';

// =============================================================================
// QUIET IS NOT BROKEN, AND THE COLUMN THAT SAID SO WAS NEVER SELECTED.
//
// `integration_health.last_successful_sync` is written on every successful
// event and was read by nothing. The page showed `last_event_at` — when data
// last ARRIVED — and built its entire status message from it. For a
// webhook-driven source, a quiet fortnight and a dead connection produce the
// identical line: "No data in 14 days".
//
// Those are different facts and they call for different actions. A stale
// integration that has never once synced is misconfigured and the founder
// should go and fix it. A stale one that synced this morning is a quiet source
// and there is nothing to do.
//
// `institution/loop-health.ts` already says exactly this about the scheduler,
// in these words: *"Nothing happened" and "nothing ran" are different facts.*
// One rule, stated in one place and not the other, over a column that had held
// the answer the whole time.
//
// Found by asking which of the 84 write-only columns are genuinely unread. 47
// of them are reachable by a mechanism that ratchet cannot see — 22 by a
// literal `SELECT *`, 16 by a SQL trigger, 9 by the export's dynamic
// `SELECT * FROM ${table}`. This was one of the 37 that were really unread.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  await query('DELETE FROM integration_health');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function addCompany(): Promise<string> {
  const owner = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [owner, `c_${owner}`, `${owner}@example.com`]);
  const pid = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [pid, 'C', owner]);
  return pid;
}

async function health(productId: string, opts: {
  source: string; status: string; lastEventAt: string | null;
  lastSuccessfulSync: string | null; freshnessHours: number | null; failures?: number;
}) {
  await query(
    `INSERT INTO integration_health
       (id, product_id, integration_source, last_event_at, last_successful_sync,
        consecutive_failures, error_message, status, data_freshness_hours, updated_at)
     VALUES (?,?,?,?,?,?,NULL,?,?, datetime('now'))`,
    [nanoid(), productId, opts.source, opts.lastEventAt, opts.lastSuccessfulSync,
      opts.failures ?? 0, opts.status, opts.freshnessHours]);
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

describe('a stale integration', () => {
  it('says the connection still works when it does', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'stripe', status: 'stale',
      lastEventAt: daysAgo(9), lastSuccessfulSync: daysAgo(0), freshnessHours: 216,
    });

    const [row] = await getIntegrationHealth(pid);
    expect(row.status_message).toContain('No data in 9 days');
    expect(row.status_message, 'a quiet source, nothing to do').toContain('Connection last worked');
  });

  it('says it has never worked when it has not', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'stripe', status: 'stale',
      lastEventAt: daysAgo(9), lastSuccessfulSync: null, freshnessHours: 216,
    });

    const [row] = await getIntegrationHealth(pid);
    expect(row.status_message, 'misconfigured, and the founder should go and fix it')
      .toContain('never completed a sync');
  });

  it('gives two different messages for what used to be one', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'quiet', status: 'stale',
      lastEventAt: daysAgo(9), lastSuccessfulSync: daysAgo(0), freshnessHours: 216,
    });
    await health(pid, {
      source: 'broken', status: 'stale',
      lastEventAt: daysAgo(9), lastSuccessfulSync: null, freshnessHours: 216,
    });

    const rows = await getIntegrationHealth(pid);
    const quiet = rows.find((r) => r.source === 'quiet')!;
    const broken = rows.find((r) => r.source === 'broken')!;
    expect(quiet.status_message).not.toBe(broken.status_message);
    for (const r of [quiet, broken]) {
      expect(r.status_message, 'both used to read exactly this and stop')
        .toContain('No data in 9 days');
    }
  });

  it('still says something when freshness was never computed', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'stripe', status: 'stale',
      lastEventAt: null, lastSuccessfulSync: null, freshnessHours: null,
    });
    const [row] = await getIntegrationHealth(pid);
    expect(row.status_message).toContain('No recent data');
    expect(row.status_message).toContain('never completed a sync');
  });
});

describe('a failing integration', () => {
  it('names the likely cause when it has never once worked', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'stripe', status: 'error',
      lastEventAt: null, lastSuccessfulSync: null, freshnessHours: null, failures: 3,
    });
    const [row] = await getIntegrationHealth(pid);
    expect(row.status_message, 'almost always the credentials')
      .toContain('never a successful sync');
  });

  it('does not say that when it worked before', async () => {
    const pid = await addCompany();
    await health(pid, {
      source: 'stripe', status: 'error',
      lastEventAt: daysAgo(1), lastSuccessfulSync: daysAgo(1), freshnessHours: 24, failures: 3,
    });
    const [row] = await getIntegrationHealth(pid);
    expect(row.status_message).toContain('3 consecutive errors');
    expect(row.status_message).not.toContain('never a successful sync');
  });
});

describe('the fact is carried, not just used', () => {
  it('returns when the connection last worked', async () => {
    const pid = await addCompany();
    const when = daysAgo(2);
    await health(pid, {
      source: 'stripe', status: 'healthy',
      lastEventAt: when, lastSuccessfulSync: when, freshnessHours: 48,
    });
    const [row] = await getIntegrationHealth(pid);
    expect(row.last_successful_sync).toBe(when);
  });

  it('is off the write-only list, not merely mentioned', () => {
    const baseline = readFileSync('docs/db/write-only-columns-baseline.txt', 'utf8');
    expect(baseline).not.toMatch(/integration_health\.last_successful_sync/);
    const src = readFileSync('src/services/integrations/health-monitor.ts', 'utf8');
    expect(src, 'named in the SELECT, which is what makes it a read')
      .toMatch(/SELECT integration_source, status, last_event_at, last_successful_sync/);
  });
});
