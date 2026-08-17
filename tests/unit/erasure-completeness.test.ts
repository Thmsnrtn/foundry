// =============================================================================
// Tests: an erasure that erases
//
// `processScheduledDeletions` deleted from a hand-written list of thirteen
// tables, then wrote `data_deletion_completed` and told the founder their data
// was gone. The schema has TWO HUNDRED AND EIGHTEEN tables carrying
// `product_id`: agent messages, chat sessions, call transcripts, customer
// intelligence, API keys, integration records, voice sessions. About six per
// cent of a company's data was removed. The completion record was the part that
// worked.
//
// This is the campaign's recurring shape in its most consequential form — a
// rule that exists, is believed, and is enforced on the wrong thing. Here the
// wrong thing is a list somebody wrote once, against a schema that has grown by
// two hundred tables since.
//
// The list is now derived from the live schema, so what survives an erasure is
// an explicit allow-list with a reason each, and a table added next year is
// erased by default rather than quietly retained forever.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  EXCLUDED_FROM_EXPORT_REASONS, RETAINED_ON_ERASURE_REASONS,
  exportProductData, tablesToErase, tablesWithProductId,
} from '../../src/services/privacy/consent.js';

beforeAll(async () => {
  await runMigrations();
});

describe('every table holding a company is erased or explains itself', () => {
  it('covers the whole schema, not a list written once', async () => {
    const all = await tablesWithProductId();
    const erased = new Set(await tablesToErase());
    const unaccounted = all.filter(
      (t) => !erased.has(t) && !(t in RETAINED_ON_ERASURE_REASONS));
    expect(unaccounted,
      'these hold company data and neither get erased nor say why not')
      .toEqual([]);
  });

  it('erases far more than the thirteen tables it used to', async () => {
    const erased = await tablesToErase();
    expect(erased.length).toBeGreaterThan(150);
  });

  it('names the tables a founder would notice most', async () => {
    const erased = new Set(await tablesToErase());
    for (const table of [
      'agent_messages', 'chat_sessions', 'call_transcripts', 'customer_intelligence',
      'api_keys', 'integrations', 'decisions', 'metric_snapshots',
    ]) {
      expect(erased.has(table), `${table} must be erased`).toBe(true);
    }
  });

  it('gives every retained table a reason', () => {
    for (const [table, reason] of Object.entries(RETAINED_ON_ERASURE_REASONS)) {
      expect(reason.length, `${table} needs a real reason`).toBeGreaterThan(30);
    }
  });

  it('keeps the record of the erasure itself', async () => {
    // Erasing the audit log would erase the evidence that the erasure happened,
    // which is the one thing a compliance record exists to prove.
    const erased = new Set(await tablesToErase());
    expect(erased.has('agent_audit_log')).toBe(false);
    expect(RETAINED_ON_ERASURE_REASONS.agent_audit_log).toMatch(/evidence|record/i);
  });

  it('keeps at-most-once records, so a retry cannot re-send a real message', async () => {
    const erased = new Set(await tablesToErase());
    expect(erased.has('idempotency_keys')).toBe(false);
  });
});

describe('the completion record cannot outrun the deletion', () => {
  it('writes no completion record when a table could not be cleared', async () => {
    // Behavioural, not textual. The old loop swallowed every delete error with
    // a bare catch, so a table that refused left the data in place and the
    // completion record was written anyway — and a structural version of this
    // test was satisfied by a mutant that kept the throw unreachable.
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');

    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('er_f','er_c','er@example.com')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('er_p','Erase Me','er_f','active')`);
    await scheduleDataDeletion('er_p', 0);

    // One of the tables the erasure must clear refuses to be cleared. A trigger
    // rather than a rename: the table list is derived from the live schema, so
    // a renamed table is simply not in it and nothing would fail.
    await query(`INSERT INTO decisions (id, product_id, gate, what, why_now, status)
                 VALUES ('er_d','er_p',3,'something','because','approved')`);
    await query(`CREATE TRIGGER er_block BEFORE DELETE ON decisions
                 BEGIN SELECT RAISE(ABORT,'erasure_test:blocked'); END`);
    try {
      await processScheduledDeletions();
    } catch {
      // Surfacing the failure to the caller is the point; what matters is the
      // record below.
    } finally {
      await query('DROP TRIGGER er_block');
    }

    const completed = await query(
      `SELECT id FROM agent_audit_log
        WHERE event_type = 'data_deletion_completed' AND target_id = 'er_p'`);
    expect(completed.rows.length,
      'an incomplete deletion must not claim to have completed').toBe(0);

    // And the product must not be archived either — that is the signal to every
    // other subsystem that this company is finished with.
    const product = await query(`SELECT status FROM products WHERE id = 'er_p'`);
    expect((product.rows[0] as Record<string, string>).status).toBe('active');
  });

  it('honours a zero-day erasure instead of waiting a month', async () => {
    // `metadata.delete_after_days || 30`. A founder asking for erasure with no
    // waiting period records 0, which is falsy, so the request most likely to
    // be urgent was silently rescheduled thirty days out. Found because a
    // mutation-test fixture used 0 and nothing happened.
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('er_f2','er_c2','er2@example.com')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('er_p2','Now Please','er_f2','active')`);
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date)
                 VALUES ('er_m2','er_p2','2026-01-01')`);
    await scheduleDataDeletion('er_p2', 0);

    await processScheduledDeletions();

    const left = await query(`SELECT id FROM metric_snapshots WHERE product_id = 'er_p2'`);
    expect(left.rows.length, 'zero days means now, not next month').toBe(0);
    const completed = await query(
      `SELECT id FROM agent_audit_log
        WHERE event_type = 'data_deletion_completed' AND target_id = 'er_p2'`);
    expect(completed.rows.length).toBe(1);
  });

  it('still ends the operating relationship as well as the record', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/services/privacy/consent.ts'), 'utf8');
    expect(source).toMatch(/scp_status = 'archived'/);
  });
});

// =============================================================================
// The other half of the same right. Erasure and access are the same question
// asked twice, and the export had the same defect in a smaller font: a
// hand-written list of ten tables, five of them added by a fix whose comment
// reads "Export was 60% incomplete" — measured against a denominator that was
// itself a guess.
// =============================================================================

describe('an export that exports', () => {
  it('covers every table holding the company, minus recorded exclusions', async () => {
    const all = await tablesWithProductId();
    const unaccounted = all.filter((t) => !(t in EXCLUDED_FROM_EXPORT_REASONS));
    expect(unaccounted.length, 'the export is derived from the schema')
      .toBeGreaterThan(150);
    for (const reason of Object.values(EXCLUDED_FROM_EXPORT_REASONS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('returns the tables that actually hold rows, and omits the empty ones', async () => {
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('ex_f','ex_c','ex@example.com')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status) VALUES ('ex_p','Exportable','ex_f','active')`);
    await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date)
                 VALUES ('ex_m','ex_p','2026-02-01')`);
    await query(`INSERT INTO decisions (id, product_id, gate, what, why_now, status)
                 VALUES ('ex_d','ex_p',2,'ship it','because','approved')`);

    const data = await exportProductData('ex_p', 'json');
    expect(Object.keys(data)).toContain('metric_snapshots');
    expect(Object.keys(data)).toContain('decisions');
    expect(Object.keys(data), 'a table with no rows is noise, not completeness')
      .not.toContain('competitors');
  });

  it('redacts credential material rather than handing it back', async () => {
    // A subject access request is a right to one's own data, not a mechanism
    // for extracting a live token to whoever holds the session right now.
    await query(
      `INSERT INTO integrations (id, product_id, type, status, credentials_json)
       VALUES ('ex_i','ex_p','slack','active','{"bot_token":"xoxb-REALSECRET"}')`);
    const data = await exportProductData('ex_p', 'json');
    const rows = data.integrations as Array<Record<string, unknown>>;
    expect(rows.length, 'the row still appears, so the founder sees the connection exists')
      .toBe(1);
    expect(rows[0].credentials_json).toBe('[redacted]');
    expect(JSON.stringify(data)).not.toContain('REALSECRET');
  });
});
