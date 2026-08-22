process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// ONE EVENT STORE, NOT TWO.
//
// `temporal_events` (migration 012) and `signal_events` (migration 051) were
// both per-product streams of typed events. `signal_events` is the live one:
// sixteen writers, ten readers, and the single door into responsibility
// discovery. `temporal_events` had one writer and one reader, both in
// `services/temporal/replay.ts`, and NEITHER FUNCTION HAD A CALLER anywhere —
// no route, no job, no agent, no test, no script. The table was guaranteed
// empty from the day it was created.
//
// One concept with two stores is a disagreement waiting to happen, and this
// one never surfaced only because one of the two was always empty. Migration
// 194 drops it.
//
// WHY THIS TEST EXISTS RATHER THAN A GATE. The pair of gates that should have
// caught it could not, and the reason generalises. `check-writerless-tables`
// asks whether every table live code READS has something that writes it;
// `check-unread-tables` asks whether every table live code WRITES has something
// that reads it. This table had one of each, so each gate found the other's
// half and stopped. Neither gate knows a function's callers — they read SQL.
//
// The obvious fix, teaching those gates about call graphs, was measured before
// being built: across all 236 tables the src tree touches, the check produced
// four candidates and two of them were false positives — one from attributing
// SQL inside a route handler to the last named function above it, one from a
// string-stripper that swallowed a dynamic `await import`. A gate that is wrong
// half the time is worse than the blind spot, so the blind spot is written down
// instead, and this test pins the one instance that mattered.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

beforeAll(async () => { await runMigrations(); });

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('the dead second event store is gone', () => {
  it('leaves no temporal_events table after every migration applies', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'temporal_events'`,
    );
    expect(rows.rows.length).toBe(0);
  });

  it('keeps the live one', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'signal_events'`,
    );
    expect(rows.rows.length).toBe(1);
  });

  it('leaves nothing in the source tree that would write to it again', () => {
    // The gates cannot see this shape, so the absence is asserted directly.
    // A reintroduced writer/reader pair would pass check-writerless-tables and
    // check-unread-tables exactly as the original did.
    const offenders = sourceFiles(join(ROOT, 'src'))
      .filter((f) => readFileSync(f, 'utf8').includes('temporal_events'))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });
});
