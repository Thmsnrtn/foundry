process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { likeContains, escapeLikeValue } from '../../src/lib/sql-like.js';

// =============================================================================
// A WILDCARD THE MODEL CHOSE.
//
// `POST /api/ask` classifies a founder's message with a model, and a
// `resolve_stressor` action took the `stressor_name` the model extracted
// straight into `LIKE '%' || name || '%' LIMIT 1` — then marked the single row
// it found resolved. The query is parameterised and there is no SQL injection
// here; the injection is into the PATTERN, and the consequence is that the row
// written to is not the row anybody meant.
//
// `%` matches the company's FIRST ACTIVE STRESSOR, whatever it is. Nobody has
// to intend that: "resolve the 20% churn stressor" carries one, and so does a
// message that talks the classifier into answering with a bare wildcard.
// =============================================================================

const P = 'p_like';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_lk','c_lk','lk@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_lk','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM stressor_history');
  for (const [id, name] of [
    ['sh_1', 'Runway compression'],
    ['sh_2', 'Churn above 20% and climbing'],
  ]) {
    await query(
      `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status)
       VALUES (?, ?, ?, 'x', 30, 'y', 'watch', 'active')`,
      [id, P, name]);
  }
});

/** The query the resolve_stressor action runs. */
const find = (name: string) => query(
  `SELECT id FROM stressor_history WHERE product_id = ? AND status = 'active'
   AND stressor_name LIKE ? ESCAPE '\\' LIMIT 1`,
  [P, likeContains(name)]);

describe('resolving a stressor by name', () => {
  it('finds the one that was named', async () => {
    const rows = await find('Runway');
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as unknown as { id: string }).id).toBe('sh_1');
  });

  it('treats a bare wildcard as the character it is', async () => {
    // It used to match the FIRST ACTIVE ROW whatever it was — here 'sh_1',
    // "Runway compression", which contains no per cent sign at all. As a
    // literal it matches only the name that really has one.
    const rows = await find('%');
    const ids = (rows.rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain('sh_1');
    expect(ids).toEqual(['sh_2']);
  });

  it('matches nothing at all when no name contains one', async () => {
    await query("DELETE FROM stressor_history WHERE id = 'sh_2'");
    expect((await find('%')).rows).toHaveLength(0);
  });

  it('does not match everything when the name is an underscore', async () => {
    expect((await find('_')).rows).toHaveLength(0);
  });

  it('still finds a name that legitimately contains a per cent sign', async () => {
    const rows = await find('20%');
    expect(rows.rows).toHaveLength(1);
    expect((rows.rows[0] as unknown as { id: string }).id).toBe('sh_2');
  });

  it('does not let a per cent sign in the name widen the match', async () => {
    // '%climbing' would match "Churn above 20% and climbing" if the % were a
    // wildcard, and matches nothing as a literal.
    expect((await find('%climbing')).rows).toHaveLength(0);
  });
});

describe('the escaping itself', () => {
  it('escapes the escape character too', () => {
    expect(escapeLikeValue('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text alone', () => {
    expect(likeContains('runway')).toBe('%runway%');
  });
});

describe('the call sites', () => {
  it('escape the value and name the escape character', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    for (const f of [
      'src/routes/api/ask.ts',
      'src/services/scp/memory/graph.ts',
      'src/services/scp/accuracy/tracker.ts',
    ]) {
      // Comments stripped: three of these files explain the defect in prose
      // that contains the very pattern being forbidden.
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      expect(src, `${f} builds a LIKE pattern by hand`).not.toMatch(/`%\$\{/);
      expect(src, `${f} does not name the escape character`).toContain("ESCAPE '\\\\'");
    }
  });
});
