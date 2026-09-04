// =============================================================================
// FOUNDRY - keeping a copy of everything.
//
// THE WHOLE INSTITUTION IS ONE FILE. Every fact this place holds lives in a
// single SQLite database on a single volume attached to a single machine: what
// he owns, what he has said, what Foundry may and may not do, every observation
// it has ever made and every reason it has ever given. Ninety-five routines ran
// every day and not one of them copied it.
//
// The operator documents described a hosted database this deployment does not
// use, which is worse than having no plan written down: it reads like an answer
// and would be discovered to be fiction at the only moment it mattered.
//
// VACUUM INTO is SQLite's own consistent copy — safe against a live
// write-ahead log, no lock anyone else must hold, no new dependency, and the
// result is an ordinary database file that can simply be opened. It does not
// survive losing the volume; the volume's own snapshots are for that. It
// survives what actually happens: a corruption, a bad migration, a delete
// nobody meant.
// =============================================================================

import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { query } from '../../db/client.js';

/** Long enough to notice something went wrong and still have a copy from before it. */
const KEEP_DAYS = 14;

export interface Kept {
  /** The file written, or '' when nothing was. */
  wrote: string;
  bytes: number;
  kept: number;
  removed: number;
  /** Set when there was nothing to do, with the honest reason. */
  skipped: string | null;
}

/**
 * WHERE THE DATABASE ACTUALLY IS.
 *
 * Only a file database can be copied this way, and saying so is better than
 * writing a backup that silently does nothing on a hosted one.
 */
function databaseFile(): string | null {
  const url = (process.env.TURSO_DATABASE_URL ?? '').trim();
  if (!url.startsWith('file:')) return null;
  const path = url.slice('file:'.length).split('?')[0] ?? '';
  // An in-memory database has nothing to keep.
  if (path === '' || path.startsWith(':memory:')) return null;
  return path;
}

export async function copyTheInstitution(now = new Date()): Promise<Kept> {
  const file = databaseFile();
  if (file === null) {
    return { wrote: '', bytes: 0, kept: 0, removed: 0,
      skipped: 'the database is not a file here, so there is nothing to copy' };
  }

  const into = join(dirname(file), 'backups');
  await mkdir(into, { recursive: true });
  const stamp = now.toISOString().slice(0, 10);
  const target = join(into, `foundry-${stamp}.db`);

  // WRITTEN BESIDE, THEN MOVED INTO PLACE.
  //
  // VACUUM INTO refuses to write over an existing file, so a second run on the
  // same day failed outright — a restart, or a hand-run after something went
  // wrong, which is exactly when a copy is wanted most. Writing to a temporary
  // name and renaming also means a copy that fails halfway never replaces a
  // good one: the rename is the only moment anything changes.
  const beside = `${target}.writing`;
  await rm(beside, { force: true });
  // The path is interpolated because SQLite takes no parameter here. It is
  // built from the configured database location and a date, never from input.
  await query(`VACUUM INTO '${beside.replace(/'/g, "''")}'`);
  await rename(beside, target);
  const wrote = await stat(target);

  // AND THE OLD ONES GO, so a volume sized for a database is not filled by
  // copies of it.
  let removed = 0;
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const all = (await readdir(into)).filter((n) => n.startsWith('foundry-') && n.endsWith('.db'));
  for (const name of all) {
    const each = join(into, name);
    if (each === target) continue;
    if ((await stat(each)).mtimeMs < cutoff) {
      await unlink(each);
      removed += 1;
    }
  }

  return {
    wrote: target, bytes: wrote.size, kept: all.length - removed, removed, skipped: null,
  };
}

/**
 * WHAT WOULD BE THERE IF TODAY WENT WRONG.
 *
 * Read back rather than assumed: a backup nobody has ever looked at is a belief,
 * not a copy.
 */
export async function whatIsKept(): Promise<Array<{ name: string; bytes: number; at: string }>> {
  const file = databaseFile();
  if (file === null) return [];
  const into = join(dirname(file), 'backups');
  try {
    const names = (await readdir(into))
      .filter((n) => n.startsWith('foundry-') && n.endsWith('.db')).sort().reverse();
    const out = [];
    for (const name of names) {
      const s = await stat(join(into, name));
      out.push({ name, bytes: s.size, at: new Date(s.mtimeMs).toISOString() });
    }
    return out;
  } catch { return []; }
}
