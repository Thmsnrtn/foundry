process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  companyDataSources, exportProductData, EXCLUDED_FROM_EXPORT_REASONS,
} from '../../src/services/privacy/consent.js';
import { contributorHash } from '../../src/services/wisdom/network.js';

// =============================================================================
// THE ERASURE KNEW ABOUT FIFTY-FIVE TABLES THE EXPORT COULD NOT SEE.
//
// `exportProductData` swept `tablesWithProductId()` and nothing else. Its own
// header says why the denominator matters — an earlier version exported ten
// tables against a guessed denominator, and "an access request answered with
// ten of them is not an access request answered."
//
// The same file, four hundred lines down, spends a long section establishing
// that fifty-five tables carry no `product_id` and that three quarters of them
// ARE company data: eleven children hanging off erased parents, and the ones
// naming their subject as a contributor hash, a scope id, or the first
// component of a composite key. The erasure had to go and find every one.
//
// "This is yours and goes when you go" and "this is not yours to receive" are
// the same claim read two ways. One derivation now, two consumers.
// =============================================================================

const P = 'axr_product';
const F = 'axr_founder';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`,
    [F, 'axr_clerk', 'axr@example.com']);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Axr Co',?,'active')`,
    [P, F]);

  // A child hanging off an erased parent: the parent carries product_id, the
  // child does not, and the export could not reach it.
  await query(
    `INSERT INTO chat_sessions (id, founder_id, product_id, title) VALUES ('axr_s',?,?,'A talk')`,
    [F, P]);
  await query(
    `INSERT INTO chat_messages (id, session_id, role, content)
     VALUES ('axr_m','axr_s','founder','the thing I actually said')`);

  // A table naming the company by a composite id prefix.
  await query(
    `INSERT INTO network_contributions
       (id, metric, market_category, lifecycle_stage, mrr_bracket, value)
     VALUES (?, 'churn_rate', 'unknown', 'growth', '0-5k', 4.2)`,
    [`${P}_week_churn_rate`]);

  // A table naming the company by contributor hash.
  await query(
    `INSERT INTO decision_patterns
       (id, decision_type, product_lifecycle_stage, risk_state_at_decision,
        key_metrics_context, option_chosen_category, outcome_direction,
        outcome_magnitude, market_category, contributor_hash)
     VALUES ('axr_dp','pricing_change','growth','green','{}','raise',
             'positive','significant','marketplace', ?)`,
    [contributorHash(P)]);
});

describe('a company asking for its own data', () => {
  it('receives what it said, not only the conversation it said it in', async () => {
    const out = await exportProductData(P, 'json');
    expect(Object.keys(out)).toContain('chat_sessions');
    expect(out.chat_messages, 'the child rows are the content').toBeDefined();
    expect(JSON.stringify(out.chat_messages)).toContain('the thing I actually said');
  });

  it('receives the rows that name it by a composite key', async () => {
    const out = await exportProductData(P, 'json');
    expect(out.network_contributions).toHaveLength(1);
    expect(JSON.stringify(out.network_contributions)).toContain('churn_rate');
  });

  it('receives the rows that name it by contributor hash', async () => {
    const out = await exportProductData(P, 'json');
    expect(out.decision_patterns).toHaveLength(1);
  });

  it('receives no other company’s rows through any of those keys', async () => {
    const out = await exportProductData('axr_someone_else', 'json');
    expect(out.network_contributions).toBeUndefined();
    expect(out.decision_patterns).toBeUndefined();
    expect(out.chat_messages).toBeUndefined();
  });
});

describe('the export and the erasure agree about what is the company’s', () => {
  it('hands back every row the erasure would take from this company', async () => {
    // Empty tables are omitted from the file by design, so this asks the
    // question the other way round: for each place the erasure WOULD delete
    // from, does this company actually have rows there — and if so, are they in
    // the export? A table that answers yes and no is one the erasure takes and
    // the access request never mentions.
    const sources = await companyDataSources();
    const out = await exportProductData(P, 'json');
    const contributor = contributorHash(P);
    const missing: string[] = [];

    for (const source of sources) {
      if (source.table in EXCLUDED_FROM_EXPORT_REASONS) continue;
      const subject = source.subject === 'contributor_hash' ? contributor : P;
      const held = await query(
        `SELECT COUNT(*) AS n FROM ${source.table} WHERE ${source.predicate}`, [subject],
      ).catch(() => null);
      const n = held ? Number((held.rows[0] as Record<string, unknown>).n) : 0;
      if (n > 0 && !(source.table in out)) missing.push(source.table);
    }

    expect(missing, 'the erasure can see these rows and the export could not')
      .toEqual([]);
  });

  it('is asking about more than the tables that carry product_id', async () => {
    // Guards the test above from passing vacuously: if every source were a
    // plain `product_id = ?` table, it would be asserting nothing new.
    const sources = await companyDataSources();
    const otherKeyed = sources.filter((s) => s.predicate !== 'product_id = ?');
    expect(otherKeyed.length).toBeGreaterThan(10);
    expect(otherKeyed.map((s) => s.table)).toContain('chat_messages');
    expect(otherKeyed.map((s) => s.table)).toContain('network_contributions');
  });

  it('states a reason for every table it leaves out', () => {
    for (const [table, reason] of Object.entries(EXCLUDED_FROM_EXPORT_REASONS)) {
      expect(reason.length, `${table} has a reason, not a shrug`).toBeGreaterThan(20);
    }
  });
});
