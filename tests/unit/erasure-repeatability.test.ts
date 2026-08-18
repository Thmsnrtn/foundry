// =============================================================================
// Tests: an erasure must be repeatable, isolated, and honest about failing
//
// The completeness of a single erasure was proved elsewhere. This is about the
// run: what happens the second time, what happens when one product cannot be
// erased, and what the job reports when it erased nothing.
//
// The defect this file was written for is the middle one. The inner catch
// carried this comment:
//
//   "Recorded and rethrown to the caller's per-product catch, which leaves the
//    deletion pending and retries it on the next run."
//
// There was no per-product catch. The throw left `processScheduledDeletions`
// entirely, so one product whose erasure could not complete — a trigger
// refusing a delete, a foreign key, a corrupt row — aborted the whole batch.
// Every founder queued behind it was skipped. Daily. Their requests stayed
// pending, correctly, and nothing anywhere said so. A described guarantee that
// was never implemented is worse than an absent one, because it is the reason
// nobody looked.
//
// And the selection carried the other trap this campaign keeps finding:
//
//   AND target_id NOT IN (SELECT target_id FROM ... WHERE event_type = ...)
//
// `x NOT IN (a, NULL)` is NULL in SQLite, never true. `target_id` is nullable.
// One completion row with a null target would have returned nothing, for
// everybody, permanently, silently.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'er_founder';

async function makeProduct(id: string, name: string): Promise<void> {
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status, ingest_token)
     VALUES (?,?,?, 'active','active',?)`, [id, name, F, `${id}_tok`]);
  // Something to erase, so "deleted everything" is distinguishable from
  // "there was nothing there".
  await query(
    `INSERT INTO agent_audit_log
       (id, product_id, event_type, actor_type, description, ip_address)
     VALUES (?, ?, 'agent_run', 'system', 'ordinary activity', '10.0.0.1')`,
    [nanoid(), id]);
}

async function auditRows(productId: string, eventType: string): Promise<number> {
  const r = await query(
    `SELECT COUNT(*) AS n FROM agent_audit_log
      WHERE target_id = ? AND event_type = ?`, [productId, eventType]);
  return Number((r.rows[0] as Record<string, unknown>).n);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'er_clerk', 'er@example.com']);
});

describe('running it twice converges', () => {
  it('erases on the first run and does nothing on the second', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await makeProduct('er_twice', 'Twice Co');
    await scheduleDataDeletion('er_twice', 0);

    const first = await processScheduledDeletions();
    expect(first.completed).toBe(1);
    expect(first.failed).toEqual([]);

    const second = await processScheduledDeletions();
    expect(second.completed, 'a completed erasure is not pending work').toBe(0);
    expect(second.failed).toEqual([]);

    expect(await auditRows('er_twice', 'data_deletion_completed'),
      'one erasure, one completion record — not one per run forever').toBe(1);
  });

  it('leaves the redacted fields redacted rather than restoring them', async () => {
    const row = (await query(
      `SELECT name, ingest_token, status, scp_status FROM products WHERE id = ?`,
      ['er_twice'])).rows[0] as Record<string, unknown>;
    expect(row.name).toBe('[erased]');
    expect(row.ingest_token).toBeNull();
    expect(row.status).toBe('archived');
    expect(row.scp_status).toBe('archived');
  });

  it('reports zero rather than throwing when nothing is due', async () => {
    const { processScheduledDeletions } = await import(
      '../../src/services/privacy/consent.js');
    expect(await processScheduledDeletions()).toEqual({ completed: 0, failed: [] });
  });

  it('does not erase before the requested delay has passed', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await makeProduct('er_later', 'Later Co');
    await scheduleDataDeletion('er_later', 30);
    expect((await processScheduledDeletions()).completed).toBe(0);
    expect((await query('SELECT name FROM products WHERE id = ?', ['er_later']))
      .rows[0]).toMatchObject({ name: 'Later Co' });
  });
});

describe('one founder’s failure is not everybody’s', () => {
  it('erases the others and reports the one that could not be', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await makeProduct('er_bad', 'Poison Co');
    await makeProduct('er_ok1', 'Fine One');
    await makeProduct('er_ok2', 'Fine Two');
    for (const p of ['er_bad', 'er_ok1', 'er_ok2']) await scheduleDataDeletion(p, 0);

    // A delete that cannot succeed, of the kind a real schema produces: a
    // trigger that refuses. The erase list is derived from the live schema, so
    // this table is in it without anything being told about it — which is the
    // point: the erasure code cannot know what will refuse.
    await query(
      `CREATE TABLE IF NOT EXISTS er_poison (id TEXT PRIMARY KEY, product_id TEXT NOT NULL)`);
    await query(
      `INSERT INTO er_poison (id, product_id) VALUES (?, 'er_bad')`, [nanoid()]);
    await query(`
      CREATE TRIGGER er_refuse BEFORE DELETE ON er_poison
      BEGIN SELECT RAISE(ABORT, 'test:refuses_deletion'); END`);

    try {
      const outcome = await processScheduledDeletions();

      expect(outcome.failed.map((f) => f.productId),
        'the one that could not be erased is named').toEqual(['er_bad']);
      expect(outcome.completed,
        'and the two behind it in the queue were still erased').toBe(2);

      for (const ok of ['er_ok1', 'er_ok2']) {
        expect((await query('SELECT name FROM products WHERE id = ?', [ok]))
          .rows[0], `${ok} was queued behind a failure and must still be erased`)
          .toMatchObject({ name: '[erased]' });
      }
    } finally {
      await query('DROP TRIGGER er_refuse');
    }
  });

  it('does not claim the failed one completed', async () => {
    expect(await auditRows('er_bad', 'data_deletion_completed'),
      'a completion record for an erasure that did not happen is the worst of both')
      .toBe(0);
    expect(await auditRows('er_bad', 'data_deletion_failed'),
      'and the attempt leaves evidence, or the only record is an absence')
      .toBe(1);
  });

  it('retries the failed one once the obstruction is gone', async () => {
    const { processScheduledDeletions } = await import(
      '../../src/services/privacy/consent.js');
    const outcome = await processScheduledDeletions();
    expect(outcome.completed, 'still pending, and now able to succeed').toBe(1);
    expect(outcome.failed).toEqual([]);
    expect((await query('SELECT name FROM products WHERE id = ?', ['er_bad']))
      .rows[0]).toMatchObject({ name: '[erased]' });
    await query('DROP TABLE er_poison');
  });
});

describe('the selection cannot be switched off by a NULL', () => {
  it('keeps finding pending erasures when a completion row has no target', async () => {
    // `x NOT IN (a, NULL)` is NULL, not true. One such row and the subquery
    // used to exclude every product in the system — no error, no erasures, no
    // sign of it anywhere.
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await makeProduct('er_null', 'Null Co');
    await scheduleDataDeletion('er_null', 0);
    await query(
      `INSERT INTO agent_audit_log
         (id, product_id, event_type, actor_type, target_id, description)
       VALUES (?, 'er_null', 'data_deletion_completed', 'system', NULL, 'no target')`,
      [nanoid()]);

    expect((await processScheduledDeletions()).completed,
      'a single null-targeted row must not disable erasure for everybody').toBe(1);
  });
});

describe('a table added later cannot fall outside the classification', () => {
  it('is erased by default rather than silently retained', async () => {
    // The erase list is derived from the live schema, so the fail-closed
    // direction is "delete unless a disposition says otherwise". A new table
    // with a product_id must not need anyone to remember it.
    const { tablesToErase, RETAINED_ON_ERASURE_REASONS } = await import(
      '../../src/services/privacy/consent.js');
    await query(
      `CREATE TABLE IF NOT EXISTS er_new_feature (
         id TEXT PRIMARY KEY, product_id TEXT NOT NULL, secret TEXT)`);
    try {
      expect(await tablesToErase()).toContain('er_new_feature');
      expect(Object.keys(RETAINED_ON_ERASURE_REASONS),
        'and retention stays an explicit, reasoned allow-list')
        .not.toContain('er_new_feature');
    } finally {
      await query('DROP TABLE er_new_feature');
    }
  });

  it('and every retention still states its category, basis and processing', async () => {
    const { RETAINED_ON_ERASURE_REASONS } = await import(
      '../../src/services/privacy/consent.js');
    for (const [table, d] of Object.entries(RETAINED_ON_ERASURE_REASONS)) {
      expect(d.basis.length, `${table} must say why it survives`).toBeGreaterThan(20);
      expect(d.processing.length, `${table} must say what may be done with it`)
        .toBeGreaterThan(10);
      expect(d.category, `${table} must be classified`).toBeTruthy();
    }
  });
});
