// =============================================================================
// Tests: every literal SQL string in the source must prepare against the real
//        schema
//
// `check-select-columns.mjs` closed the tractable case statically — single-table
// SELECTs, no JOIN, no alias — and paid down 34 queries that raised the moment
// they ran. It says what it skips, honestly:
//
//   "single-table SELECT only — anything with a JOIN or an alias is skipped"
//
// Which leaves the queries most likely to be wrong outside the gate. The
// founder-details query in Shield is a JOIN; so is half of the reporting layer.
// A static parser cannot resolve those. SQLite can: preparing a statement
// resolves every column against the real migrated schema and refuses one that
// does not exist, JOIN or not.
//
// So this prepares them. It runs nothing — `prepare` alone is enough to fail on
// a missing table or column, and it cannot touch data.
//
// What it does not cover is stated rather than implied: queries assembled with
// `${...}` are skipped, because the string in the file is not the string that
// runs. Those remain the responsibility of the tests that exercise them.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { RUNTIME_CREATED_TABLES } from '../fixtures/runtime-created-tables.js';

const SRC = resolve(__dirname, '../../src');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

interface Candidate { file: string; line: number; sql: string }

function candidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const file of tsFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/`([^`]*)`/g)) {
      const sql = m[1];
      if (!/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql)) continue;
      // Assembled at runtime — the literal here is not what executes.
      if (sql.includes('${')) continue;
      // Statements the schema cannot answer for: DDL in migrations, and the
      // erasure plan's derived SQL, which is built from the live catalogue.
      if (/\bpragma_/i.test(sql)) continue;
      out.push({
        file: relative(SRC, file),
        line: source.slice(0, m.index).split('\n').length,
        sql,
      });
    }
  }
  return out;
}

const ALL = candidates();

beforeAll(async () => {
  await runMigrations();
});

describe('literal SQL resolves against the migrated schema', () => {
  it('finds a meaningful number of statements to check', () => {
    // A gate that silently matched nothing would pass forever. If a refactor
    // moves every query behind a builder, this is the line that notices.
    expect(ALL.length).toBeGreaterThan(300);
  });

  it('prepares every one of them', async () => {
    const failures: string[] = [];
    for (const c of ALL) {
      try {
        // EXPLAIN forces preparation — every table and column is resolved —
        // and executes nothing of the statement itself.
        await query(`EXPLAIN ${c.sql}`, new Array((c.sql.match(/\?/g) ?? []).length).fill(null));
      } catch (err) {
        const message = (err as Error).message;
        // Only schema resolution is this gate's business. A statement that
        // prepares but would fail on a constraint, a type, or a trigger is
        // somebody else's test, and reporting it here would make this noisy
        // enough to be turned off.
        if (!/no such (column|table)/i.test(message)) continue;
        // Tables the application creates at call time, or reads inside a
        // catch that tolerates their absence. The same list the
        // no-phantom-tables gate uses, with the same reasons attached.
        const missingTable = message.match(/no such table: (\w+)/)?.[1];
        if (missingTable && missingTable in RUNTIME_CREATED_TABLES) continue;
        failures.push(`${c.file}:${c.line} → ${message}`);
      }
    }
    expect(failures, 'a query naming a column the schema does not have raises when it runs')
      .toEqual([]);
  });
});
