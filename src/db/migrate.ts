// =============================================================================
// FOUNDRY — Database Migration Runner
// Applies all pending SQL migration files in order on startup.
// Tracks applied migrations in schema_migrations table.
// ALTER TABLE errors (duplicate column) are swallowed — migrations are idempotent.
// =============================================================================

import { getDb } from './client.js';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Split a SQL migration into individual statements.
 *
 * A naive `split(/;\s*\n/)` breaks on any semicolon-then-newline, including
 * ones inside string literals or a CREATE TRIGGER ... BEGIN ... END body, and
 * a blanket `--` strip corrupts dashes inside string literals. This walks the
 * text tracking string/comment state and trigger depth, and only splits on a
 * top-level `;`. Comments are stripped only when genuinely outside a string.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;   // '...'  (SQLite escapes an inner quote as '')
  let inLine = false;     // -- ... to end of line
  let inBlock = false;    // /* ... */
  let triggerDepth = 0;   // BEGIN..END nesting, only tracked inside CREATE TRIGGER

  const isTriggerStmt = () => /\bcreate\s+trigger\b/i.test(current);
  const wordEndsAt = (i: number, word: string): boolean => {
    if (sql.slice(i, i + word.length).toLowerCase() !== word) return false;
    const before = sql[i - 1];
    const after = sql[i + word.length];
    const boundary = (c: string | undefined) => c === undefined || !/[A-Za-z0-9_]/.test(c);
    return boundary(before) && boundary(after);
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLine) {
      if (ch === '\n') { inLine = false; current += ch; }
      continue; // drop comment characters
    }
    if (inBlock) {
      if (ch === '*' && next === '/') { inBlock = false; i++; }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (next === "'") { current += next; i++; } // escaped quote, stay in string
        else inSingle = false;
      }
      continue;
    }

    // Outside strings/comments:
    if (ch === '-' && next === '-') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    if (ch === "'") { inSingle = true; current += ch; continue; }

    // Trigger body tracking so semicolons inside BEGIN..END don't split.
    //
    // CASE COUNTS TOO. A `CASE ... END` inside a trigger body closes with the
    // same keyword as the body itself, so counting only BEGIN made the CASE's
    // `END` cancel the trigger's — the body was then cut at its first internal
    // semicolon and SQLite reported "incomplete input" on a statement that was
    // perfectly well formed. This function's own comment says it respects
    // trigger bodies; it respected the ones nobody had written a CASE in yet.
    if (isTriggerStmt()) {
      if (wordEndsAt(i, 'begin') || wordEndsAt(i, 'case')) { triggerDepth++; }
      else if (wordEndsAt(i, 'end')) { if (triggerDepth > 0) triggerDepth--; }
    }

    if (ch === ';' && triggerDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      triggerDepth = 0;
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Tracking table — must exist before anything else
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    args: [],
  });

  const migrationsDir = resolve(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 001_... < 002_... etc.

  const applied = await db.execute({ sql: 'SELECT filename FROM schema_migrations', args: [] });
  const appliedSet = new Set(applied.rows.map((r) => (r as Record<string, string>).filename));

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;

    console.log(`[MIGRATE] Applying ${file}...`);
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');

    // Split into statements, respecting string literals, comments, and trigger
    // BEGIN..END bodies (see splitSqlStatements).
    const statements = splitSqlStatements(sql);

    for (const stmt of statements) {
      try {
        await db.execute({ sql: stmt, args: [] });
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? '';
        // SQLite: "duplicate column name" — column was added by a prior migration.
        // Turso/libSQL may surface this as "already exists".
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          continue;
        }
        // Any other error is fatal
        console.error(`[MIGRATE] Error in ${file}:\n  ${stmt}\n  ${msg}`);
        throw err;
      }
    }

    await db.execute({
      sql: 'INSERT INTO schema_migrations (filename) VALUES (?)',
      args: [file],
    });

    console.log(`[MIGRATE] ✓ ${file}`);
    ran++;
  }

  if (ran === 0) {
    console.log('[MIGRATE] All migrations already applied.');
  } else {
    console.log(`[MIGRATE] Applied ${ran} migration(s).`);
  }
}
