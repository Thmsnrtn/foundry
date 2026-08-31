process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getSyncHealth } from '../../src/services/integrations/health.js';

// =============================================================================
// AN INTEGRATION THAT STOPPED, AND NOBODY SAID SO.
//
// A failed sync set `integrations.status = 'error'`. The hourly job selected
// `WHERE status = 'active'`. So the integration was never tried again — not that
// night, not ever. One timed-out request, one expired token, one bad hour at
// Stripe, and the company's revenue numbers quietly stopped moving until the
// founder happened to open the Integrations page and press Connect.
//
// Nothing announced it. No retry, no backoff, no limit, no notice — because
// there was no retry to bound and nothing decided to stop: the stop was a side
// effect of a WHERE clause.
//
// Nor could the founder find it by looking. `status`, `last_synced_at` and
// `last_error` describe THIS MOMENT and forget everything before it, and every
// provider module cleared `last_error` on success. An integration failing four
// nights in five showed a green badge, a recent sync time and no error at all.
// Every one of those attempts was in `integration_sync_log`, which nothing read.
//
// And the page's whole distinction between working and broken was `badge-green`
// against `badge-red` — two class names that were not defined in any
// stylesheet, so both rendered as the same grey pill.
//
// Now: errored integrations are retried to a stated limit; crossing that limit
// is a decision, announced once as a signal; the page shows the trailing week of
// attempts and says plainly when Foundry has given up.
//
// ONE TABLE, TWO WRITERS. `sync.ts` writes `status` and `error_message`;
// `framework.ts` writes `errors` and leaves `status` NULL. Migration 056
// reconciled the two declarations of the table and nothing reconciled the two
// ways of writing to it, so the reader derives success rather than trusting
// either spelling.
// =============================================================================

const SYNC = readFileSync('src/services/integrations/sync.ts', 'utf8');
const PAGE = readFileSync('src/routes/dashboard/integrations.ts', 'utf8');
const CSS = readFileSync('src/public/styles.css', 'utf8');

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_sync','c_sync','s@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_sync','Acme','f_sync','active')");
});
beforeEach(async () => {
  await query('DELETE FROM integration_sync_log');
  await query('DELETE FROM integrations');
});

async function integration(status: string, errorCount: number): Promise<string> {
  const id = `int_${nanoid(6)}`;
  await query(
    `INSERT INTO integrations (id, product_id, provider, direction, status, error_count)
     VALUES (?, 'p_sync', 'stripe', 'inbound', ?, ?)`, [id, status, errorCount]);
  return id;
}

async function attempt(
  integrationId: string,
  o: { status?: string | null; error_message?: string | null; errors?: string | null;
       finished?: boolean; ago?: string },
) {
  await query(
    `INSERT INTO integration_sync_log
       (id, integration_id, product_id, started_at, completed_at, status, error_message, errors)
     VALUES (?, ?, 'p_sync', datetime('now', ?), ?, ?, ?, ?)`,
    [nanoid(), integrationId, o.ago ?? '-1 hours',
      o.finished === false ? null : new Date().toISOString(),
      o.status ?? null, o.error_message ?? null, o.errors ?? null]);
}

describe('an errored integration is tried again', () => {
  it('the sync query no longer excludes it', () => {
    expect(SYNC).toMatch(/status IN \('active', 'error'\)/);
    expect(SYNC, "selecting only 'active' is what made one failure permanent")
      .not.toMatch(/WHERE product_id = \? AND status = 'active'/);
  });

  it('stops after a stated number of consecutive failures', () => {
    expect(SYNC).toMatch(/export const MAX_CONSECUTIVE_SYNC_FAILURES = 5;/);
    expect(SYNC).toMatch(/COALESCE\(error_count, 0\) < \?/);
  });

  it('restores the integration to health on success, not just the error text', () => {
    expect(SYNC).toMatch(/SET status = 'active', last_error = NULL, error_count = 0/);
  });

  it('counts failures rather than only recording the latest', () => {
    expect(SYNC).toMatch(/error_count = COALESCE\(error_count, 0\) \+ 1/);
  });
});

describe('giving up is announced', () => {
  it('emits exactly on the crossing, not on every failure after it', () => {
    expect(SYNC).toMatch(/if \(failures === MAX_CONSECUTIVE_SYNC_FAILURES\)/);
    expect(SYNC, 'a >= test would re-announce a stop that already happened')
      .not.toMatch(/failures >= MAX_CONSECUTIVE_SYNC_FAILURES/);
  });

  it('says what stopped and what it means', () => {
    // `type` held a provider key, a direction or a category depending on the
    // writer; the sentence names WHO, so it reads the column that means who.
    // Migration 204 retired `type`, so the fallback is a word rather than the
    // other column — a notification with no provider on it should say so, not
    // name a direction.
    expect(SYNC).toMatch(/Foundry stopped syncing \$\{integration\.provider \?\? 'an integration'\}/);
    expect(SYNC).toMatch(/has stopped updating/);
    expect(SYNC).toMatch(/importance: 'action_needed'/);
  });

  it('goes through the interruption ceiling, not through responsibility discovery', () => {
    // `emitSignalEvent` is the single door into responsibility discovery and has
    // exactly one caller by design — the company reporting something about
    // itself. An integration timing out is Foundry's own plumbing. Reaching for
    // that function here would admit internal failures into the responsibility
    // ladder, which is precisely what
    // `discovery-is-not-reachable-from-integrations.test.ts` forbids. It caught
    // this on the first full run.
    expect(SYNC).not.toMatch(/emitSignalEvent\s*\(/);
    expect(SYNC).toMatch(/const \{ deliver \} = await import\('\.\.\/ux\/interruption\.js'\)/);
  });

  it('keeps the provider error text out of the notification', () => {
    // The provider's message is external content. It is already stored on the
    // integration row and shown, escaped, on the page.
    const block = SYNC.slice(SYNC.indexOf("importance: 'action_needed'"),
                             SYNC.indexOf('actionUrl:'));
    expect(block).not.toMatch(/errorMessage/);
  });
});

describe('the trailing week of attempts is readable', () => {
  it('counts successes and failures written by sync.ts', async () => {
    const id = await integration('active', 0);
    await attempt(id, { status: 'success' });
    await attempt(id, { status: 'failed', error_message: 'HTTP 500' });
    await attempt(id, { status: 'success' });

    const h = (await getSyncHealth('p_sync')).get(id)!;
    expect(h.attempts).toBe(3);
    expect(h.succeeded).toBe(2);
    expect(h.failed).toBe(1);
  });

  it('counts failures written by framework.ts, which never sets status', async () => {
    const id = await integration('active', 0);
    await attempt(id, { status: null, errors: JSON.stringify(['token expired']) });
    await attempt(id, { status: null, errors: null });

    const h = (await getSyncHealth('p_sync')).get(id)!;
    expect(h.failed, 'a NULL status is not a success').toBe(1);
    expect(h.succeeded).toBe(1);
  });

  it('does not call a sync that never finished a success', async () => {
    const id = await integration('active', 0);
    await attempt(id, { status: 'running', finished: false });

    const h = (await getSyncHealth('p_sync')).get(id)!;
    expect(h.unfinished).toBe(1);
    expect(h.succeeded).toBe(0);
    expect(h.failed).toBe(0);
  });

  it('stops at the window', async () => {
    const id = await integration('active', 0);
    await attempt(id, { status: 'failed', error_message: 'x', ago: '-30 days' });
    expect((await getSyncHealth('p_sync')).get(id)).toBeUndefined();
  });

  it('returns no entry rather than a clean bill of health', async () => {
    const id = await integration('active', 0);
    expect((await getSyncHealth('p_sync')).get(id)).toBeUndefined();
    expect(PAGE, 'and the page has to say that, not stay silent')
      .toMatch(/No sync has been attempted in the last/);
  });
});

describe('the page shows it', () => {
  it('reads the history', () => {
    expect(PAGE).toMatch(/getSyncHealth/);
    expect(PAGE).toMatch(/syncs failed in the last/);
  });

  it('distinguishes "failing" from "no longer being tried"', () => {
    expect(PAGE).toMatch(/const givenUp = /);
    expect(PAGE).toMatch(/Foundry has stopped syncing this/);
  });

  it('has the colours its badges have always asked for', () => {
    for (const cls of ['.badge-green', '.badge-red', '.badge-gray']) {
      expect(CSS, `${cls} was named on the page and defined nowhere`).toContain(cls);
    }
    expect(CSS).toContain('.integration-sync-history-warn');
  });
});

describe('the ratchets moved', () => {
  it('integration_sync_log has left the unread baseline', () => {
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .not.toMatch(/integration_sync_log/);
  });
});
