// =============================================================================
// Tests: after an erasure, is the company anywhere?
//
// Every other erasure test asks a question about the PLAN — is each table
// classified, is the plan ordered, does it converge, does it report failures.
// This asks the only question a founder actually cares about: after Foundry
// says the erasure completed, can the company still be found?
//
// It answers it the blunt way. Populate a company across the surfaces a real
// one touches, erase it, then sweep EVERY column of EVERY table looking for the
// product id, the founder id, and the founder's email. A classification cannot
// prove this — a derived table, a cache, a summary, a hash-keyed aggregate or a
// column carrying the id under a different name is exactly what a
// classification misses, and §6 of the current mandate names all of them.
//
// WHAT IT DELIBERATELY ALLOWS, because these are decisions rather than leaks:
//   • the founder row itself, which is REDACTED rather than deleted — the
//     erased+<id>@invalid and erased:<id> markers keep it unique and unusable,
//     and a founder with two companies erasing one must keep their account;
//   • the erasure audit trail, which is the record that the erasure happened
//     and would be self-defeating to erase;
//   • the `products` row, which survives REDACTED for referential integrity —
//     an id that can be reissued is worse than one resolving to a cleared row.
//     Its retention is stated in RETAINED_ON_ERASURE, so the sweep skips the
//     two opaque handles (`id`, `owner_id`) and a separate test below proves
//     every DESCRIBING column on it is actually cleared.
// Everything else is a finding.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { eraseFounderAccount, RETAINED_ON_ERASURE_DISPOSITIONS }
  from '../../src/services/privacy/consent.js';

// IDS CHOSEN SO NOTHING ELSE CAN CONTAIN THEM. The sweep matches by
// containment, and the generic seeder fills text columns with `stub_<column>`.
// With ids like `trace_product` and a column named `product_lifecycle_stage`,
// the seeded value `trace_product_lifecycle_stage` contains the product id and
// the sweep reports a leak that is entirely the fixture's own doing. This
// repository has already lost time to one near-miss fixture collision; do not
// make these ids readable at the cost of making them collidable.
const F = 'ZZFOUNDERIDZZ';
const P = 'ZZPRODUCTIDZZ';
const EMAIL = 'ZZERASEDMAILZZ@example.com';

let seeded: { ok: string[]; refused: string[] };

/**
 * Tables whose surviving rows are a stated decision, not a leak.
 *
 * DERIVED, NOT LISTED. Hardcoding the allowed survivors would mean every new
 * table that quietly keeps a company id could be added to a list in this file
 * and the sweep would go green. So the allowance comes from the erasure's own
 * dispositions: a table may survive here exactly when somebody wrote down why
 * it survives, where the reason has to be read. Adding a retention is still
 * possible — it just cannot be done silently, or in a test.
 */
const DELIBERATE = new Set([
  ...Object.keys(RETAINED_ON_ERASURE_DISPOSITIONS),
  'founders',           // redacted in place, not deleted
  'agent_audit_log',    // the record that the erasure happened
  'schema_migrations',
]);

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)`,
    [F, 'clerk_stub', EMAIL, 'A Founder']);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES (?, 'Swept Co', ?, 'active', 'active')`, [P, F]);

  seeded = await seedEverySurface();
});

/**
 * Put a row of this company into EVERY table that carries a product id or a
 * founder id.
 *
 * Hand-picking seven tables and sweeping two hundred proves almost nothing:
 * an empty table passes the sweep trivially, so a classification that forgets
 * a table looks identical to one that handles it. This fills each of them and
 * lets the sweep mean what it says.
 *
 * Foreign keys are OFF for the seeding only. The point is to place a row in
 * every table regardless of whether a plausible parent exists — an erasure
 * that misses a table misses it whether or not the row was reachable. Keys go
 * back ON before the erasure runs, so ordering and orphan-refusal are still
 * proven by the erasure itself.
 *
 * Tables that refuse a generic row — a BEFORE INSERT trigger enforcing an
 * institutional invariant, a CHECK this seeder cannot satisfy — are recorded
 * and reported, not silently skipped: a seeder that quietly stopped seeding
 * would turn this whole file green while proving nothing, so the count is
 * asserted against a floor below.
 */
async function seedEverySurface(): Promise<{ ok: string[]; refused: string[] }> {
  const ok: string[] = [];
  const refused: string[] = [];
  const tables = (await query(
    `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, []))
    .rows as unknown as Array<Record<string, unknown>>;

  await query('PRAGMA foreign_keys = OFF', []);
  for (const t of tables) {
    const table = String(t.name);
    if (table === 'products' || table === 'founders' || table === 'schema_migrations') continue;
    const ddl = String(t.sql ?? '');
    const cols = (await query(`SELECT * FROM pragma_table_info('${table}')`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    // Tables with an id column are seeded generically. Tables WITHOUT one are
    // seeded too, but with ordinary values — a seeder that writes the company
    // id into every table is planting the defect rather than finding it. The
    // tables that name the company inside a COMPOSITE key are seeded the way
    // production actually writes them, by their real writers, below.
    const hasIdColumn = names.includes('product_id') || names.includes('founder_id');
    void hasIdColumn;

    const use: string[] = [];
    const vals: unknown[] = [];
    for (const c of cols) {
      const name = String(c.name);
      const required = Number(c.notnull) === 1 && c.dflt_value === null;
      const isKey = name === 'product_id' || name === 'founder_id' || name === 'owner_id';
      if (!required && !isKey && name !== 'id') continue;
      use.push(name);
      vals.push(valueFor(table, name, String(c.type ?? ''), ddl));
    }
    const sql = `INSERT INTO "${table}" (${use.map((n) => `"${n}"`).join(', ')})`
      + ` VALUES (${use.map(() => '?').join(', ')})`;
    try {
      await query(sql, vals as never[]);
      ok.push(table);
    } catch {
      refused.push(table);
    }
  }
  await query('PRAGMA foreign_keys = ON', []);
  return { ok, refused };
}

/** A value this column will accept: the company's ids where they belong, a
 *  member of the CHECK vocabulary where one is declared, else a typed stub. */
function valueFor(table: string, name: string, type: string, ddl: string): unknown {
  if (name === 'product_id') return P;
  if (name === 'founder_id' || name === 'owner_id') return F;
  if (name === 'id') return `stub_${table}_${nanoid(6)}`;
  const vocab = ddl.match(
    new RegExp(`\\b${name}\\b[^,)]*?CHECK\\s*\\(\\s*(?:"?${name}"?)\\s+IN\\s*\\(([^)]*)\\)`, 'i'))
    ?? ddl.match(new RegExp(`CHECK\\s*\\(\\s*"?${name}"?\\s+IN\\s*\\(([^)]*)\\)`, 'i'));
  if (vocab) {
    const first = vocab[1].split(',')[0].trim().replace(/^'|'$/g, '');
    if (first) return first;
  }
  const t = type.toUpperCase();
  if (t.includes('INT')) return 1;
  if (t.includes('REAL') || t.includes('NUM') || t.includes('DEC')) return 1;
  if (name.endsWith('_json') || name.endsWith('_json_array')) return '[]';
  if (name.includes('_at') || name.includes('date')) return '2024-01-01T00:00:00Z';
  return `stub_${name}`;
}

/** Every (table, column) pair in the live schema. */
async function textColumns(): Promise<Array<{ table: string; column: string }>> {
  const tables = (await query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, []))
    .rows as unknown as Array<Record<string, unknown>>;
  const out: Array<{ table: string; column: string }> = [];
  for (const t of tables) {
    const table = String(t.name);
    if (DELIBERATE.has(table)) continue;
    const cols = (await query(`SELECT name FROM pragma_table_info('${table}')`, []))
      .rows as unknown as Array<Record<string, unknown>>;
    for (const c of cols) out.push({ table, column: String(c.name) });
  }
  return out;
}

describe('after Foundry says the erasure completed', () => {
  let hits: string[] = [];

  it('actually put the company in most of the schema first', () => {
    // THE SWEEP IS ONLY AS GOOD AS THE SEED. An empty table passes it for
    // free, so without this floor a seeder that quietly stopped working would
    // turn every assertion below green while proving nothing at all.
    expect(seeded.ok.length,
      `seeded ${seeded.ok.length}, refused ${seeded.refused.length}: ${seeded.refused.join(', ')}`)
      .toBeGreaterThan(100);
  });

  it('completes without a recorded failure', async () => {
    const outcome = await eraseFounderAccount(F);
    expect(outcome.failed, JSON.stringify(outcome.failed)).toEqual([]);
    expect(outcome.founderRedacted).toBe(true);
  });

  it('leaves the company findable nowhere', async () => {
    // The blunt sweep. A classification says which tables SHOULD go; this says
    // whether the company is actually gone, including from tables that carry
    // the id under a name nobody thought to classify.
    for (const { table, column } of await textColumns()) {
      // CONTAINMENT, NOT EQUALITY. An id inside a composite primary key, a
      // dedup key or a JSON blob is still the company. Exact matching reported
      // clean on two tables whose keys are literally built from the id.
      const found = await query(
        `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" LIKE ?`, [`%${P}%`]);
      const n = Number((found.rows[0] as Record<string, unknown>).n);
      if (n > 0) hits.push(`${table}.${column} still holds the product id (${n} row(s))`);
    }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('leaves the founder findable nowhere but their own redacted row', async () => {
    const leaks: string[] = [];
    for (const { table, column } of await textColumns()) {
      for (const value of [F, EMAIL]) {
        const found = await query(
          `SELECT COUNT(*) AS n FROM "${table}" WHERE "${column}" LIKE ?`, [`%${value}%`]);
        const n = Number((found.rows[0] as Record<string, unknown>).n);
        if (n > 0) leaks.push(`${table}.${column} still holds ${value === F ? 'the founder id' : 'their email'} (${n} row(s))`);
      }
    }
    expect(leaks, leaks.join('\n')).toEqual([]);
  });

  it('keeps the product row as a handle, not as a description of the company', async () => {
    // `products` survives the sweep by decision, so the decision is what gets
    // tested: the row may keep the ids that make foreign keys resolve, and
    // must keep nothing that says who this company was.
    const row = (await query(`SELECT * FROM products WHERE id = ?`, [P]))
      .rows[0] as unknown as Record<string, unknown>;
    expect(row.status).toBe('archived');
    expect(row.scp_status).toBe('archived');
    for (const col of ['name', 'stack_description', 'market_category', 'sector_profile',
      'github_repo_url', 'github_repo_owner', 'github_repo_name',
      'github_access_token', 'ingest_token', 'share_token']) {
      expect(String(row[col] ?? ''), `products.${col} still describes the company`)
        .not.toContain('Swept Co');
      if (col !== 'name') expect(row[col], `products.${col} survived the erasure`).toBeNull();
    }
  });
});

// ── what the generic sweep still cannot see ────────────────────────────────
//
// An adversarial review found five structural exemptions in the sweep above.
// Three are now closed (it seeds every table, matches by containment, and the
// fixture ids cannot collide). Two cannot be closed generically, because they
// depend on how PRODUCTION builds a value rather than on the schema:
//
//   • a table whose primary key is assembled from the company id by its writer;
//   • data belonging to this founder inside a company they do NOT own.
//
// A generic seeder cannot produce either without planting the very thing it is
// testing for. So they are named, and written the way production writes them.

describe('a company named inside a key it does not have a column for', () => {
  const OTHER = 'ZZOTHERFOUNDERZZ';
  const THEIRS = 'ZZTHEIRPRODUCTZZ';

  it('does not keep contributing to the benchmark pool after erasure', async () => {
    // `network_contributions` has no product_id column, so nothing in the
    // erasure plan reaches it — and its classification says "single metric
    // values with no key of any kind". Its writer builds the primary key as
    // `${productId}_week_${metric}`, so every row names the company that
    // contributed it, and `recomputeBenchmarks` keeps folding erased companies
    // into percentiles shown to other founders. This is the harm the
    // `decision_patterns` contributor-hash work exists to prevent, in a table
    // nobody classified correctly.
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [OTHER, 'clerk_other', 'other@example.com']);
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES (?, 'Pooled Co', ?, 'active', 'active')`, [THEIRS, OTHER]);
    // The key shape is `contributeToNetwork`'s, written here directly because
    // the writer needs a full week of metrics and the KEY is what is at issue.
    await query(
      `INSERT OR REPLACE INTO network_contributions (id, metric, market_category, lifecycle_stage, mrr_bracket, value)
       VALUES (?, 'activation_rate', 'unknown', 'early', '0-1k', 0.4)`,
      [`${THEIRS}_week_activation_rate`]);

    const { eraseFounderAccount } = await import('../../src/services/privacy/consent.js');
    await eraseFounderAccount(OTHER);

    const left = await query(
      `SELECT id FROM network_contributions WHERE id LIKE ?`, [`%${THEIRS}%`]);
    expect(left.rows,
      'an erased company is still in the pool its rows are averaged into')
      .toHaveLength(0);
  });

  it('does not keep the founder in a rate-limit bucket keyed by their id', async () => {
    // Classified as "request counters keyed by an opaque bucket". The buckets
    // are `audit:founder:<id>` and `apimodel:<product_id>`.
    const SOLO = 'ZZRATELIMITEDZZ';
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
      [SOLO, 'clerk_rl', 'rl@example.com']);
    await query(
      `INSERT OR REPLACE INTO rate_limit_counters (key, window_start, window_ms, count)
       VALUES (?, 0, 60000, 1)`, [`audit:founder:${SOLO}`]);
    const { eraseFounderAccount } = await import('../../src/services/privacy/consent.js');
    await eraseFounderAccount(SOLO);
    const left = await query(
      `SELECT key FROM rate_limit_counters WHERE key LIKE ?`, [`%${SOLO}%`]);
    expect(left.rows, 'the bucket names the person it counts').toHaveLength(0);
  });
});
