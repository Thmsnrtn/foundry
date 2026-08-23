process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getSyncHealth, recordSyncAttempt, SYNC_HEALTH_WINDOW_DAYS,
} from '../../src/services/integrations/health.js';

// =============================================================================
// A SYNC THAT LEFT NO TRACE.
//
// Six event syncs — sentry, linear, intercom, slack, posthog, github — run
// every hour or two against every operating product. Each one updates
// `integrations.last_synced_at` and `last_error`: the three columns this
// module's own header calls the ones that "describe THIS MOMENT and forget
// everything before it", and the reason `integration_sync_log` was introduced.
// None of the six wrote that log.
//
// So the integrations page, which is careful and right, told the founder "No
// sync has been attempted in the last 7 days" about integrations Foundry had
// been syncing all week. `getSyncHealth`'s contract says an absent entry means
// no attempt was RECORDED and must be said as such — the page said it, and the
// sentence was still false, because the writer was missing rather than the
// attempt.
//
// `last_error` was equally invisible: the page renders it only when `status` is
// 'error', and none of the six touches `status`. A sync failing every night set
// a column nothing rendered.
//
// AND THE JOBS THREW THE REST AWAY, five ways. Each import was wrapped in a
// `.catch` substituting a function that returns `{ synced: 0 }`, so a module
// that could not be LOADED became a clean zero. `allSettled` results were read
// as `fulfilled ? synced : 0`, so a sync that threw contributed zero silently.
// All six return `{ synced, error? }` and the `error` was never read. A
// per-product `catch {}` swallowed what was left. And nothing was logged but a
// single total that could not tell "nothing to sync" from "everything broken".
// =============================================================================

const P = 'p_sync';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_s','c_s','s@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_s','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM integration_sync_log WHERE product_id = ?', [P]);
  await query('DELETE FROM integrations WHERE product_id = ?', [P]);
});

async function connected(provider: string): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO integrations (id, product_id, name, type, status) VALUES (?, ?, ?, ?, 'active')`,
    [id, P, provider, provider]);
  return id;
}

describe('an attempt the founder can see', () => {
  it('records a successful sync where the page reads it', async () => {
    const id = await connected('sentry');

    await recordSyncAttempt({
      productId: P, provider: 'sentry',
      startedAt: new Date().toISOString(), recordsProcessed: 3,
    });

    const health = await getSyncHealth(P, SYNC_HEALTH_WINDOW_DAYS);
    expect(health.get(id)).toMatchObject({ attempts: 1, succeeded: 1, failed: 0, unfinished: 0 });
    expect(health.get(id)?.last_success_at).not.toBeNull();
  });

  it('records a failure as a failure, with what went wrong', async () => {
    const id = await connected('slack');

    await recordSyncAttempt({
      productId: P, provider: 'slack',
      startedAt: new Date().toISOString(), recordsProcessed: 0,
      error: 'token expired',
    });

    const health = await getSyncHealth(P, SYNC_HEALTH_WINDOW_DAYS);
    expect(health.get(id)).toMatchObject({ attempts: 1, succeeded: 0, failed: 1 });

    const row = await query(
      'SELECT status, error_message FROM integration_sync_log WHERE product_id = ?', [P]);
    expect((row.rows[0] as unknown as { status: string }).status).toBe('failed');
    expect((row.rows[0] as unknown as { error_message: string }).error_message).toBe('token expired');
  });

  it('separates four nights of failure from one success, which the three columns could not', async () => {
    const id = await connected('linear');
    for (let i = 0; i < 4; i++) {
      await recordSyncAttempt({
        productId: P, provider: 'linear', startedAt: new Date().toISOString(),
        recordsProcessed: 0, error: 'rate limited',
      });
    }
    await recordSyncAttempt({
      productId: P, provider: 'linear', startedAt: new Date().toISOString(), recordsProcessed: 2,
    });

    const health = await getSyncHealth(P, SYNC_HEALTH_WINDOW_DAYS);

    // `integrations.last_error` would have been cleared by the fifth run and
    // the page would have shown a green badge and a recent sync time.
    expect(health.get(id)).toMatchObject({ attempts: 5, succeeded: 1, failed: 4 });
  });

  it('records nothing for a provider the company has not connected', async () => {
    // The sync returns zero for that reason, and a row here would make "no
    // integration" look like a sync that found nothing.
    await recordSyncAttempt({
      productId: P, provider: 'intercom',
      startedAt: new Date().toISOString(), recordsProcessed: 0,
    });

    const rows = await query('SELECT COUNT(*) AS n FROM integration_sync_log WHERE product_id = ?', [P]);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(0);
  });

  it('writes the vocabulary the reader derives success from', async () => {
    // `sync.ts` writes `status` + `error_message`; `framework.ts` writes
    // `errors` and leaves `status` NULL. A third writer with a third spelling
    // is how this table stopped meaning one thing. This one matches sync.ts.
    await connected('github');
    await recordSyncAttempt({
      productId: P, provider: 'github', startedAt: new Date().toISOString(), recordsProcessed: 1,
    });

    const row = (await query(
      'SELECT status, completed_at, error_message FROM integration_sync_log WHERE product_id = ?', [P]))
      .rows[0] as unknown as { status: string; completed_at: string | null; error_message: string | null };
    expect(row.status).toBe('success');
    expect(row.completed_at).not.toBeNull();
    expect(row.error_message).toBeNull();
  });
});
