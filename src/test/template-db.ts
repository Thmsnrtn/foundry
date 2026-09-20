/**
 * THE SCHEMA, ONCE.
 *
 * Every test file that touches the database replayed all of the migrations —
 * three hundred and sixty-one files, one statement at a time — into its own
 * in-memory database before its first assertion, and four hundred and fifty
 * files do. The suite's dominant cost was never the tests; it was building
 * the same empty institution four hundred and fifty times.
 *
 * This is the template: the first file to migrate dumps what the migrations
 * produced — every object in `sqlite_master`, every seed row the migrations
 * inserted, and the `schema_migrations` markers — into one SQL text keyed by
 * a hash of the migration files; every later file restores that text with a
 * single call. The restored database is proven equal to the migrated one by
 * `the-template-is-the-schema.test.ts`: the same objects with the same SQL,
 * the same rows in every table, and the same guards refusing the same writes.
 *
 * Order matters and is deliberate: tables first, then the seed rows, then
 * indexes, views and triggers — because a migration's BEFORE INSERT guard
 * would refuse the very seed rows the migration wrote before the guard
 * existed. Foreign keys are off for the restore and on again after it, so
 * seed rows land in creation order rather than dependency order.
 *
 * Off by `FOUNDRY_MIGRATION_TEMPLATE=off`, which is how the proof migrates
 * the honest way to compare against.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Client, InValue } from '@libsql/client';

export const TEMPLATE_RESTORED = '[MIGRATE] Restored the schema from the template';

/** One key per set of migration files: any edit to any migration is a new template. */
export function templateKey(migrationsDir: string): string {
  const h = createHash('sha256');
  for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith('.sql')).sort()) {
    h.update(f); h.update('\0'); h.update(readFileSync(resolve(migrationsDir, f))); h.update('\0');
  }
  return h.digest('hex').slice(0, 24);
}

export function templatePath(key: string): string {
  return resolve(process.cwd(), 'node_modules', '.cache', 'foundry-schema-template', `${key}.sql`);
}

export function templateWanted(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.FOUNDRY_MIGRATION_TEMPLATE !== 'off'
    && (process.env.TURSO_DATABASE_URL ?? '').includes(':memory:');
}

const ident = (s: string): string => `"${s.replace(/"/g, '""')}"`;
const literal = (v: InValue | ArrayBuffer | Uint8Array | null | undefined): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return `X'${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** The migrated database as one SQL text: objects, seed rows, guards — in the order a restore needs. */
export async function dumpTemplate(db: Client): Promise<string> {
  const objects = (await db.execute({ sql: `SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`, args: [] })).rows
    .map((r) => ({ type: String(r.type), name: String(r.name), sql: String(r.sql) }));
  const tables = objects.filter((o) => o.type === 'table');
  const others = objects.filter((o) => o.type !== 'table');
  const out: string[] = [];
  for (const t of tables) out.push(`${t.sql};`);
  for (const t of tables) {
    const rs = await db.execute({ sql: `SELECT * FROM ${ident(t.name)}`, args: [] });
    if (rs.rows.length === 0) continue;
    const cols = rs.columns.map(ident).join(', ');
    for (const row of rs.rows) {
      const vals = rs.columns.map((_, i) => literal(row[i] as InValue)).join(', ');
      out.push(`INSERT INTO ${ident(t.name)} (${cols}) VALUES (${vals});`);
    }
  }
  for (const o of others) out.push(`${o.sql};`);
  return out.join('\n');
}

/** Restore a dump into an empty database, with foreign keys off for the copy and on after it. */
export async function restoreTemplate(db: Client, text: string): Promise<void> {
  await db.execute({ sql: 'PRAGMA foreign_keys = OFF', args: [] });
  try {
    await db.executeMultiple(text);
  } finally {
    await db.execute({ sql: 'PRAGMA foreign_keys = ON', args: [] });
  }
}

export function readTemplate(key: string): string | null {
  const p = templatePath(key);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** Written whole, then renamed: a half-written template is never read by another worker. */
export function writeTemplate(key: string, text: string): void {
  const p = templatePath(key);
  mkdirSync(resolve(p, '..'), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}
