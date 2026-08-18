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
  EXCLUDED_FROM_EXPORT_REASONS, NOT_COMPANY_DATA_REASONS, RETAINED_ON_ERASURE_REASONS,
  exportProductData, tablesToErase, tablesWithProductId,
} from '../../src/services/privacy/consent.js';

beforeAll(async () => {
  await runMigrations();
});

describe('every table holding a company is erased or explains itself', () => {
  it('covers the whole schema, not a list written once', async () => {
    const all = await tablesWithProductId();
    const erased = new Set(await tablesToErase());
    // Three ways a table may account for itself, and all three carry a written
    // reason: it is erased, it is retained for a stated purpose, or it is not a
    // customer's data at all. The third is one table — `system_identities`,
    // which names WHICH PRODUCT ROW IS FOUNDRY — and it needs saying here
    // because it carries a `product_id` like everything else and would
    // otherwise read as an omission.
    const unaccounted = all.filter(
      (t) => !erased.has(t)
        && !(t in RETAINED_ON_ERASURE_REASONS)
        && !(t in NOT_COMPANY_DATA_REASONS));
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

  it('gives every retained table a disposition, not just a sentence', () => {
    // A table name is not a legal conclusion. A disposition says which fields
    // are kept, what may be done with them, and when the decision is revisited.
    for (const [table, d] of Object.entries(RETAINED_ON_ERASURE_REASONS)) {
      expect(d.basis.length, `${table} needs a real basis`).toBeGreaterThan(30);
      expect(d.processing.length, `${table} must say what may be done with it`)
        .toBeGreaterThan(10);
      expect(['compliance_evidence', 'financial_record', 'safety_control',
        'referential_integrity']).toContain(d.category);
      // null is allowed — "evidence that an erasure happened" does not expire
      // on a timer — but the field has to be a deliberate answer.
      expect(d.reviewAfterDays === null || typeof d.reviewAfterDays === 'number').toBe(true);
    }
  });

  it('retains nothing the erasure never touched', () => {
    // stripe_webhook_events and ai_daily_spend carry no product_id, so an
    // erasure never reached them. Recording a retention decision for a table
    // that was never at risk is a legal conclusion attached to a table name.
    for (const table of Object.keys(RETAINED_ON_ERASURE_REASONS)) {
      expect(['agent_audit_log', 'products', 'ai_spend_reservations', 'idempotency_keys'])
        .toContain(table);
    }
  });

  it('keeps the record of the erasure itself', async () => {
    // Erasing the audit log would erase the evidence that the erasure happened,
    // which is the one thing a compliance record exists to prove.
    const erased = new Set(await tablesToErase());
    expect(erased.has('agent_audit_log')).toBe(false);
    expect(RETAINED_ON_ERASURE_REASONS.agent_audit_log.basis).toMatch(/evidence|record/i);
    expect(RETAINED_ON_ERASURE_REASONS.agent_audit_log.processing,
      'retained data is restricted data: surviving an erasure is not a licence')
      .toMatch(/never product cognition|compliance evidence only/i);
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

// =============================================================================
// §9–§11: retention is a disposition, not a table name. What survives, on what
// terms, and what may be done with it afterwards.
// =============================================================================

describe('what survives an erasure survives on stated terms', () => {
  const P = 'ret_p';

  it('keeps the erasure evidence and deletes the rest of the activity log', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('ret_f','ret_c','ret@example.com')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status, stack_description, market_category)
       VALUES (?,'Retention Co','ret_f','active','a stack','b2b_saas')`, [P]);
    // Ordinary activity, and an IP address on it.
    await query(
      `INSERT INTO agent_audit_log (id, product_id, event_type, actor_type, actor_id,
                                    target_type, target_id, description, ip_address)
       VALUES ('ret_a1', ?, 'agent_action', 'agent', 'compass', 'decision', 'd1',
               'raised the price', '203.0.113.9')`, [P]);
    // Something whose retained purpose keeps only part of the row.
    await query(
      `INSERT INTO idempotency_keys (id, product_id, agent_id, action_type, dedup_key,
                                     result_json, expires_at)
       VALUES ('ret_i1', ?, 'a', 'send_email', 'dk1',
               '{"to":"customer@example.com"}', datetime('now','+1 day'))`, [P]);
    await query(
      `INSERT INTO ai_spend_reservations
         (id, product_id, founder_id, date, model, reserved_cents, global_cap_cents,
          status, created_at, updated_at, expires_at)
       VALUES ('ret_r1', ?, 'ret_f', '2026-01-01', 'sonnet', 12, 5000, 'settled',
               datetime('now'), datetime('now'), datetime('now','+1 day'))`, [P]);

    await scheduleDataDeletion(P, 0);
    await processScheduledDeletions();

    // The erasure record is the evidence, and it is still here.
    const evidence = await query(
      `SELECT event_type, ip_address FROM agent_audit_log WHERE product_id = ?`, [P]);
    const types = (evidence.rows as unknown as Array<Record<string, string | null>>)
      .map((r) => r.event_type);
    expect(types).toContain('data_deletion_completed');
    expect(types, 'the rest of the log is not evidence of the erasure')
      .not.toContain('agent_action');
    for (const row of evidence.rows as unknown as Array<Record<string, string | null>>) {
      expect(row.ip_address, 'an address is not part of the evidence').toBeNull();
    }
  });

  it('keeps the control and drops the payload', async () => {
    const row = (await query(
      `SELECT dedup_key, result_json FROM idempotency_keys WHERE id = 'ret_i1'`))
      .rows[0] as Record<string, string | null> | undefined;
    expect(row?.dedup_key, 'the key IS the at-most-once control').toBe('dk1');
    expect(row?.result_json, 'a stored provider response can name a recipient')
      .toBeNull();
    expect(JSON.stringify(row)).not.toContain('customer@example.com');
  });

  it('keeps the accounting and severs the person', async () => {
    const row = (await query(
      `SELECT founder_id, reserved_cents FROM ai_spend_reservations WHERE id = 'ret_r1'`))
      .rows[0] as Record<string, unknown> | undefined;
    expect(Number(row?.reserved_cents), 'the amount is the record').toBe(12);
    expect(row?.founder_id, 'an accounting total need not say whose it was').toBeNull();
  });

  it('keeps the product id and not the company', async () => {
    const row = (await query(
      `SELECT name, stack_description, market_category, status FROM products WHERE id = ?`, [P]))
      .rows[0] as Record<string, string | null>;
    expect(row.status).toBe('archived');
    expect(row.name, 'the row survives so the id cannot be reissued').toBe('[erased]');
    expect(row.stack_description).toBeNull();
    expect(row.market_category).toBeNull();
  });

  it('says in the completion record what it actually did', async () => {
    const row = (await query(
      `SELECT description, metadata_json FROM agent_audit_log
        WHERE product_id = ? AND event_type = 'data_deletion_completed'`, [P]))
      .rows[0] as Record<string, string>;
    expect(row.description).toMatch(/deleted/);
    expect(row.description, 'a record that cannot distinguish deleted from retained is unfalsifiable')
      .toMatch(/redacted|retained/);
    const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    expect(Array.isArray(meta.deleted)).toBe(true);
    expect(meta.failed).toEqual([]);
    const retention = meta.retention as Record<string, Record<string, unknown>>;
    expect(retention.agent_audit_log.basis).toBeTruthy();
    expect(retention.idempotency_keys.fields_cleared).toContain('result_json');
  });
});

describe('retained data stays restricted', () => {
  it('is not readable by anything that assembles model context', () => {
    // §11: surviving an erasure is a narrow permission to keep something, not
    // a licence to keep using it. The retained tables are compliance evidence,
    // an accounting ledger and a duplicate-suppression control — none of them
    // belongs in a prompt, an insight or an analytic.
    const { readFileSync, readdirSync, statSync } = require('fs') as typeof import('fs');
    const { join, resolve: r } = require('path') as typeof import('path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const cognition = ['services/wisdom', 'services/intelligence', 'services/chat',
      'services/conversation', 'services/scp/agents', 'services/digest'];
    const offenders: string[] = [];
    for (const dir of cognition) {
      for (const f of walk(r(__dirname, '../../src', dir))) {
        const src = readFileSync(f, 'utf8');
        for (const t of ['agent_audit_log', 'ai_spend_reservations', 'idempotency_keys']) {
          if (new RegExp(`FROM\\s+${t}\\b`, 'i').test(src)) {
            offenders.push(`${f.split('/src/')[1]} → ${t}`);
          }
        }
      }
    }
    expect(offenders, 'retained for a narrow purpose means retained for that purpose only')
      .toEqual([]);
  });
});
