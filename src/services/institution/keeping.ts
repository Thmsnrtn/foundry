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
import { createReadStream, createWriteStream } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, join } from 'node:path';
import { query } from '../../db/client.js';

// =============================================================================
// HOW FAR BACK, AND WHY THESE THREE NUMBERS
//
// Fourteen days was chosen when nobody had asked how long the owner might be
// away. The institution now states that explicitly — seven, thirty and ninety
// days — and a fourteen-day window answers only the first of them. On a
// ninety-day absence a bad migration on the second day would have had its last
// clean copy deleted seventy-six days before he opened his laptop.
//
// THE ARITHMETIC THAT MAKES THIS CHEAP. The database is about ten megabytes and
// compresses to roughly a quarter of that. Ninety daily copies would be most of
// a volume sized for the database; a thinning ladder is a few per cent of it:
//
//   14 dailies        the window where you notice a mistake and want yesterday
//  +12 weeklies       three months of Mondays, for a fault you inherit on return
//  +12 monthlies      a year, for the corruption nobody noticed for a season
//   ─────────
//   38 files, ~2.5 MB each  ≈ 95 MB of a 974 MB volume
//
// So no new provider, no new account, no new bill, and no owner decision: this
// is what the existing volume already affords.
//
// WHAT THIS DOES NOT COVER, said plainly rather than left to be discovered.
// Every copy is on the SAME VOLUME as the database. That is the right defence
// against the faults that actually happen — a bad migration, a corruption, a
// delete nobody meant — and NO defence at all against losing the volume or the
// account. The volume's own snapshots are that, and this code cannot read them,
// so it does not claim them.
const KEEP_DAYS = 14;
/** Three months of Mondays. */
const KEEP_WEEKS = 12;
/** A year of first-of-months. */
const KEEP_MONTHS = 12;

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
  // COMPRESSED, BECAUSE THE LADDER DOES NOT FIT OTHERWISE. The database is
  // mostly text and gzips to roughly a quarter; thirty-eight uncompressed
  // copies of a growing database would outrun a volume sized for one copy of
  // it, and a retention policy that cannot fit is a retention policy that gets
  // quietly shortened later. The cost is one obvious command on the way back —
  // `restoreTheInstitution` does it, and a test restores a real copy and reads
  // the institution out of it rather than trusting that it would.
  const target = join(into, `foundry-${stamp}.db.gz`);

  // WRITTEN BESIDE, THEN MOVED INTO PLACE.
  //
  // VACUUM INTO refuses to write over an existing file, so a second run on the
  // same day failed outright — a restart, or a hand-run after something went
  // wrong, which is exactly when a copy is wanted most. Writing to a temporary
  // name and renaming also means a copy that fails halfway never replaces a
  // good one: the rename is the only moment anything changes.
  const beside = `${target}.writing`;
  const plain = `${target}.plain`;
  await rm(beside, { force: true });
  await rm(plain, { force: true });
  // The path is interpolated because SQLite takes no parameter here. It is
  // built from the configured database location and a date, never from input.
  await query(`VACUUM INTO '${plain.replace(/'/g, "''")}'`);
  await pipeline(createReadStream(plain), createGzip(), createWriteStream(beside));
  await rm(plain, { force: true });
  await rename(beside, target);
  const wrote = await stat(target);

  // AND THE OLD ONES THIN OUT RATHER THAN VANISHING.
  const all = (await readdir(into)).filter(isACopy);
  let removed = 0;
  for (const name of all) {
    if (name === basename(target)) continue;
    if (worthKeeping(name, now)) continue;
    await unlink(join(into, name));
    removed += 1;
  }

  return {
    wrote: target, bytes: wrote.size, kept: all.length - removed, removed, skipped: null,
  };
}

/**
 * IS THIS COPY STILL WORTH ITS SPACE?
 *
 * Decided from the DATE IN THE NAME rather than the file's mtime. A restore, a
 * volume move or a restart can touch every file at once, and a ladder that
 * thins by mtime would then keep ninety copies of one afternoon and call it a
 * year of history. The name is what the copy is a copy OF.
 *
 * Three overlapping reasons to survive, and one is enough:
 *   within the last 14 days   — the window where you want yesterday back
 *   a Monday within 12 weeks  — three months of weekly marks
 *   the 1st within 12 months  — a year of monthly marks
 */
/** Ours to thin: a dated copy, compressed or from before compression. */
export function isACopy(name: string): boolean {
  return /^foundry-\d{4}-\d{2}-\d{2}\.db(\.gz)?$/.test(name);
}

export function worthKeeping(name: string, now: Date): boolean {
  const stamp = /^foundry-(\d{4})-(\d{2})-(\d{2})\.db(?:\.gz)?$/.exec(name);
  // A file whose name carries no date is not one of ours to thin. Leaving it
  // is the safe direction: this deletes things.
  if (!stamp) return true;
  const [, y, m, d] = stamp;
  const on = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(on.getTime())) return true;
  const days = (now.getTime() - on.getTime()) / 86_400_000;
  if (days < 0) return true;
  if (days <= KEEP_DAYS) return true;
  if (on.getUTCDay() === 1 && days <= KEEP_WEEKS * 7) return true;
  if (on.getUTCDate() === 1 && days <= KEEP_MONTHS * 31) return true;
  return false;
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
    const names = (await readdir(into)).filter(isACopy).sort().reverse();
    const out = [];
    for (const name of names) {
      const s = await stat(join(into, name));
      out.push({ name, bytes: s.size, at: new Date(s.mtimeMs).toISOString() });
    }
    return out;
  } catch { return []; }
}

/**
 * PUT A COPY BACK, AND SAY WHAT CAME BACK WITH IT.
 *
 * A BACKUP NOBODY HAS RESTORED IS A BELIEF. `whatIsKept` answers "is there a
 * file", which is the question that is easy to answer and not the one that
 * matters; this answers "does that file open, and is the institution in it".
 *
 * It restores to a path the CALLER names and never over the live database.
 * Recovery is a decision somebody makes with their hands on the machine; a
 * function that can silently overwrite the institution is a function that will
 * one day be called by a routine that meant well.
 */
export async function restoreTheInstitution(
  copy: string, into: string,
): Promise<{ bytes: number; tables: number; founders: number }> {
  const live = databaseFile();
  if (live !== null && into === live) {
    throw new Error('keeping:will_not_restore_over_the_live_database');
  }
  await rm(into, { force: true });
  if (copy.endsWith('.gz')) {
    await pipeline(createReadStream(copy), createGunzip(), createWriteStream(into));
  } else {
    await pipeline(createReadStream(copy), createWriteStream(into));
  }
  const { createClient } = await import('@libsql/client');
  const restored = createClient({ url: `file:${into}` });
  try {
    const tables = Number((((await restored.execute(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")).rows[0]) as
      Record<string, unknown>).n);
    const founders = Number((((await restored.execute(
      'SELECT COUNT(*) AS n FROM founders')).rows[0]) as Record<string, unknown>).n);
    return { bytes: (await stat(into)).size, tables, founders };
  } finally {
    restored.close();
  }
}

/**
 * HOW FAR BACK THE COPIES ACTUALLY REACH, in days, from the dates in their
 * names. The absence reading asks this to answer whether a fault on day one of
 * an absence would still have a clean copy on day N, and it must not be
 * answered from the retention CONSTANT — a policy nobody has checked against
 * the volume is a belief too.
 */
export async function howFarBackCopiesReach(now = new Date()): Promise<number | null> {
  const kept = await whatIsKept();
  if (kept.length === 0) return null;
  const oldest = kept
    .map((k) => /^foundry-(\d{4}-\d{2}-\d{2})/.exec(k.name)?.[1])
    .filter((d): d is string => d !== undefined)
    .sort()[0];
  if (oldest === undefined) return null;
  return Math.floor((now.getTime() - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000);
}
