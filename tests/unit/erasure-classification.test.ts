// =============================================================================
// Tests: erasure keyed on one column name, and the schema has 55 tables
//        without it
//
// `tablesWithProductId()` derives the erase list from the live schema, which
// made the list unable to drift — for the 215 tables that carry the column.
// Fifty-five do not, and treating that silence as "not company data" was wrong
// for three quarters of them.
//
// Twelve are CHILDREN of tables that are erased: chat_messages hangs off
// chat_sessions, webhook_deliveries off webhooks, key_results off company_okrs,
// okr_progress_updates off key_results two levels down. Their parents were
// deleted and they were not.
//
// And it is worse than orphans. Seven of those foreign keys are ON DELETE NO
// ACTION and this database runs with foreign_keys=ON, so `DELETE FROM
// chat_sessions` RAISES for any company that ever sent a chat message. The
// erasure did not leave a little behind on a real company — it could not
// finish at all, and (until the run was made per-product) took every other
// founder's erasure down with it.
//
// Two more name the subject under a different column. `peer_reviews` calls it
// `reviewee_product_id`. `decision_patterns` carries only a `contributor_hash`
// — which is how an erased company's decisions kept being aggregated into
// insights published to its competitors, long after it asked to be forgotten.
//
// The rest genuinely belong to the founder or to the institution. That is a
// decision, so it is written down with a reason each: "nobody thought about
// it" and "somebody thought about it and it stays" must not look the same.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

const F = 'ec_founder';
const P = 'ec_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'ec_clerk', 'ec@example.com']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?,'Classify Co',?, 'active','active')`, [P, F]);
});

describe('every table in the schema has been decided about', () => {
  it('leaves none unclassified', async () => {
    const { classifyTables } = await import('../../src/services/privacy/consent.js');
    const unclassified = Object.entries(await classifyTables())
      .filter(([, v]) => v === 'UNCLASSIFIED').map(([t]) => t);
    expect(unclassified,
      'a table in no bucket is one the erasure steps around without anyone deciding it should')
      .toEqual([]);
  });

  it('catches a new table that carries company data under an unfamiliar key', async () => {
    // The derived half covers `product_id`. This is the half that cannot be
    // derived, and the gate is the only thing that makes it visible.
    const { classifyTables } = await import('../../src/services/privacy/consent.js');
    await query(
      `CREATE TABLE IF NOT EXISTS ec_unknown (id TEXT PRIMARY KEY, company_ref TEXT)`);
    try {
      expect((await classifyTables()).ec_unknown,
        'nothing about this table says whose the data is, and nothing should guess')
        .toBe('UNCLASSIFIED');
    } finally {
      await query('DROP TABLE ec_unknown');
    }
  });

  it('and classifies a new product_id table without being told', async () => {
    const { classifyTables } = await import('../../src/services/privacy/consent.js');
    await query(
      `CREATE TABLE IF NOT EXISTS ec_new (id TEXT PRIMARY KEY, product_id TEXT NOT NULL)`);
    try {
      expect((await classifyTables()).ec_new).toBe('erase_by_product');
    } finally {
      await query('DROP TABLE ec_new');
    }
  });

  it('states a reason for everything kept out of an erasure', async () => {
    const { FOUNDER_SCOPED_REASONS, NOT_COMPANY_DATA_REASONS } = await import(
      '../../src/services/privacy/consent.js');
    for (const [table, reason] of [
      ...Object.entries(FOUNDER_SCOPED_REASONS),
      ...Object.entries(NOT_COMPANY_DATA_REASONS),
    ]) {
      expect(reason.length, `${table} is excluded from erasure and must say why`)
        .toBeGreaterThan(15);
    }
  });
});

describe('the plan deletes children before their parents', () => {
  it('orders every child ahead of the table it hangs off', async () => {
    const { erasurePlan } = await import('../../src/services/privacy/consent.js');
    const plan = await erasurePlan();
    const position = new Map(plan.map((s, i) => [s.table, i]));
    for (const s of plan) {
      const parent = s.sql.match(/IN \(SELECT \w+ FROM (\w+)/)?.[1];
      if (!parent) continue;
      expect(position.get(s.table)!,
        `${s.table} must be deleted before ${parent}, or the foreign key refuses`)
        .toBeLessThan(position.get(parent) ?? Infinity);
    }
  });

  it('reaches two levels down', async () => {
    const { erasurePlan } = await import('../../src/services/privacy/consent.js');
    const plan = await erasurePlan();
    const deep = plan.find((s) => s.table === 'okr_progress_updates');
    expect(deep, 'a grandchild is still the company’s data').toBeDefined();
    expect(deep!.sql).toMatch(/key_results/);
    expect(deep!.sql).toMatch(/company_okrs/);
    expect(deep!.depth).toBe(2);
  });
});

describe('an erasure completes on a company that has children', () => {
  it('does not raise on a foreign key that refuses orphan parents', async () => {
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');

    // The exact shape that made this throw: one chat session with one message.
    // ON DELETE NO ACTION, foreign_keys=ON.
    const session = nanoid();
    await query(
      `INSERT INTO chat_sessions (id, product_id, founder_id) VALUES (?, ?, ?)`,
      [session, P, F]);
    await query(
      `INSERT INTO chat_messages (id, session_id, role, content)
       VALUES (?, ?, 'founder', 'our churn is up, what do I do')`, [nanoid(), session]);

    // And a webhook delivery, whose payload can carry customer content.
    const webhook = nanoid();
    await query(
      `INSERT INTO webhooks (id, product_id, founder_id, url, events, secret)
       VALUES (?, ?, ?, 'https://x', '[]', 'ec_secret')`, [webhook, P, F]);
    await query(
      `INSERT INTO webhook_deliveries (id, webhook_id, event, payload_json)
       VALUES (?, ?, 'decision.created', '{"customer":"someone@example.com"}')`,
      [nanoid(), webhook]);

    await scheduleDataDeletion(P, 0);
    const outcome = await processScheduledDeletions();
    expect(outcome.failed, 'a company with a chat history is every real company')
      .toEqual([]);
    expect(outcome.completed).toBe(1);
  });

  it('and the children are gone, not merely orphaned', async () => {
    for (const [table, col] of [['chat_messages', 'content'],
      ['webhook_deliveries', 'payload_json']] as const) {
      const rows = await query(`SELECT ${col} FROM ${table}`);
      expect(rows.rows.length,
        `${table} survived its parent — the founder's own words, kept after erasure`)
        .toBe(0);
    }
  });
});

describe('an erased company leaves the cross-company pool', () => {
  it('deletes its decision patterns, which carry no product id', async () => {
    const { contributorHash } = await import('../../src/services/wisdom/network.js');
    const { processScheduledDeletions, scheduleDataDeletion } = await import(
      '../../src/services/privacy/consent.js');

    const other = 'ec_other';
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?,'Other Co',?, 'active','active')`, [other, F]);

    for (const p of [other, 'ec_bystander']) {
      if (p === 'ec_bystander') {
        await query(
          `INSERT INTO products (id, name, owner_id, status) VALUES (?,'Bystander',?,'active')`,
          [p, F]);
      }
      await query(
        `INSERT INTO decision_patterns
           (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
            key_metrics_context, option_chosen_category, outcome_direction,
            contributor_hash)
         VALUES (?, 'pricing', 'growth', 'green', '{}', 'raise', 'positive', ?)`,
        [nanoid(), contributorHash(p)]);
    }

    await scheduleDataDeletion(other, 0);
    expect((await processScheduledDeletions()).completed).toBe(1);

    const mine = await query(
      `SELECT COUNT(*) AS n FROM decision_patterns WHERE contributor_hash = ?`,
      [contributorHash(other)]);
    expect(Number((mine.rows[0] as Record<string, unknown>).n),
      'a company that asked to be forgotten kept feeding insights sold to its competitors')
      .toBe(0);

    const theirs = await query(
      `SELECT COUNT(*) AS n FROM decision_patterns WHERE contributor_hash = ?`,
      [contributorHash('ec_bystander')]);
    expect(Number((theirs.rows[0] as Record<string, unknown>).n),
      'and nobody else’s patterns went with them')
      .toBe(1);
  });
});

// ── one erasure, not two ────────────────────────────────────────────────────

describe('there is only one implementation of erasure', () => {
  it('has no second deletion queue', async () => {
    // `src/jobs/gdpr.ts` held processAccountDeletions: unreachable, unscheduled,
    // reading a queue nothing wrote — and deleting from a HAND-WRITTEN list of
    // about twenty-five tables out of the ~266 this schema has, then writing
    // `status = 'completed'` on the request. A partial erasure that reports
    // success is worse than one that fails: the founder is told their data is
    // gone, the record says the obligation was met, and most of it is still
    // there. Dead code is survivable; a landmine is not.
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const offenders = walk('src').filter((f) => {
      const src = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      return /FROM\s+deletion_requests|FROM\s+data_export_requests/i.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('erases through the canonical plan, which classifies every table', async () => {
    // The property the hand-written list could not have: nothing is forgotten,
    // because every table is named in one of the four dispositions and the
    // classification test fails when a new one appears unclassified.
    const { runMigrations } = await import('../../src/db/migrate.js');
    await runMigrations();
    const { classifyTables } = await import('../../src/services/privacy/consent.js');
    const classified = await classifyTables();
    const unclassified = Object.entries(classified)
      .filter(([, disposition]) => disposition === 'UNCLASSIFIED')
      .map(([table]) => table);
    expect(unclassified,
      'a table nobody classified is a table erasure would silently skip').toEqual([]);
  });
});

// ── a table erasure must clear, that refuses to be cleared ──────────────────

describe('nothing in the erasure plan refuses to be erased', () => {
  it('has no table that must go and cannot', async () => {
    // The contradiction this exists for: `institutional_judgment_dispositions`
    // was append-only AND classified erase_by_product, so a founder who had ever
    // dispositioned one institutional judgment could not be erased at all — the
    // trigger aborted, the failure was recorded rather than swallowed, and the
    // founder row is deliberately left intact when any company fails.
    //
    // Append-only means history is not rewritten. It does not mean a person's
    // data outlives their right to have it removed. Any future trigger that
    // refuses a delete has to say which of the two it means, and this is where
    // it gets asked.
    const { classifyTables } = await import('../../src/services/privacy/consent.js');
    const classified = await classifyTables();

    const triggers = (await query(
      `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'`, []))
      .rows as unknown as Array<Record<string, string>>;

    const mustGo = new Set(['erase_by_product', 'erase_by_parent', 'erase_by_named_key']);
    const offenders: string[] = [];
    for (const t of triggers) {
      if (!/BEFORE\s+DELETE/i.test(t.sql)) continue;
      if (!mustGo.has(classified[t.tbl_name] ?? '')) continue;
      // A guard with no WHERE refuses every delete, erasure included.
      const body = t.sql.slice(t.sql.search(/BEGIN/i));
      const unconditional = /RAISE\s*\(\s*ABORT[^)]*\)\s*;/i.test(body);
      if (unconditional) {
        offenders.push(`${t.tbl_name} is ${classified[t.tbl_name]} but ${t.name} refuses every delete`);
      }
    }
    expect(offenders,
      'erasure cannot complete while a table it must clear refuses to be cleared')
      .toEqual([]);
  });
});
