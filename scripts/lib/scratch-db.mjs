// =============================================================================
// A scratch database that belongs to this run alone.
//
// Nine gates built their schema copy at one fixed path (`/tmp/_selcol.db` and
// siblings). Two checks at once (a second worktree, a gate test while the
// check runs) then opened the same file, and a gate failed with "database is
// locked" on a tree that had nothing wrong with it: a red that says nothing
// about the code is as costly as a green that says nothing. Each run now gets
// its own directory, removed when the process exits.
// =============================================================================
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function scratchDb(name) {
  const dir = mkdtempSync(join(tmpdir(), `foundry-${name}-`));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return join(dir, `${name}.db`);
}
