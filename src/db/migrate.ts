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

    // Split on semicolons followed by a newline (statement boundaries).
    // Ignore semicolons inside parenthesised expressions (CHECK, IN, etc.).
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.replace(/--[^\n]*/g, '').trim())
      .filter((s) => s.length > 0);

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
