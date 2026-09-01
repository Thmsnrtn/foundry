process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import {
  compareBaselinesToReality, REPOSITORY_SENTINEL, type BaselineEntry,
} from '../../src/services/foundry/self-observation.js';

// =============================================================================
// FORTY-ONE FILES THAT WERE ALL THERE.
//
// The second self-check reached production and, on its first scheduled tick,
// reported:
//
//   "41 baselined exemption(s) name something that no longer exists:
//    unreachable-modules-baseline.txt → src/mcp/cli.ts, ... "
//
// Every one of those files exists. What does not exist is the source tree in
// the RUNTIME IMAGE: the Dockerfile ships `dist/`, the migrations, `src/public`
// and `docs/db`, and no TypeScript at all. The check resolved each entry
// against the container's filesystem, found nothing, and reported deletion.
//
// This is the same mistake the deployment had already made once and fixed for
// the OTHER check — the image did not carry `docs/db`, so self-observation
// returned `snapshot_unreadable` forever. That fix taught the schema check to
// say "I could not look". This one still said "it is gone".
//
// The distinction the comparator now makes is not a heuristic about how many
// entries missed. It asks whether it is looking at the repository at all, using
// a file every checkout has and no runtime image carries. When the source is
// visible, a missing file is exactly the finding this check exists for, and
// nothing about that softens.
// =============================================================================

const entries: BaselineEntry[] = [
  { baseline: 'docs/db/unreachable-modules-baseline.txt', kind: 'module', value: 'src/mcp/cli.ts' },
  { baseline: 'docs/db/id-tiebreak-baseline.txt', kind: 'source_line', value: 'src/services/slo.ts:42' },
  { baseline: 'docs/db/unread-tables-baseline.txt', kind: 'table', value: 'a_real_table' },
  { baseline: 'docs/db/write-only-columns-baseline.txt', kind: 'column', value: 'a_real_table.a_real_column' },
];

const reality = {
  liveTables: ['a_real_table'],
  liveColumns: ['a_real_table.a_real_column'],
};

describe('reading a runtime that never carried the source', () => {
  it('does not report files it cannot see as deleted', () => {
    const observed = compareBaselinesToReality({
      entries, ...reality, fileLines: new Map(), sourceVisible: false,
    });

    expect(observed.result).toBe('passed');
    // What it could check, it checked; what it could not, it says plainly.
    expect(observed.detail).toContain('2 baselined exemption(s)');
    expect(observed.detail).toContain('2 entr(ies) naming source files were not evaluated');
    expect(observed.detail).toContain('does not carry the repository source');
  });

  it('still fails on a table entry it CAN see, blindness being partial', () => {
    const observed = compareBaselinesToReality({
      entries, liveTables: [], liveColumns: [], fileLines: new Map(), sourceVisible: false,
    });
    expect(observed.result).toBe('failed');
    expect(observed.detail).toContain('a_real_table');
    // And it still admits what it did not look at, rather than implying the
    // failure is the whole picture.
    expect(observed.detail).toContain('were not evaluated');
  });
});

describe('reading the repository', () => {
  it('reports a genuinely deleted module, which is the whole point', () => {
    const observed = compareBaselinesToReality({
      entries, ...reality, fileLines: new Map([['src/services/slo.ts', 100]]), sourceVisible: true,
    });
    expect(observed.result).toBe('failed');
    expect(observed.detail).toContain('src/mcp/cli.ts');
    expect(observed.detail).not.toContain('were not evaluated');
  });

  it('defaults to reading the repository, so no caller loses the finding by omission', () => {
    const observed = compareBaselinesToReality({
      entries, ...reality, fileLines: new Map([['src/services/slo.ts', 100]]),
    });
    expect(observed.result).toBe('failed');
    expect(observed.detail).toContain('src/mcp/cli.ts');
  });

  it('names a sentinel that this repository actually has', async () => {
    // If the sentinel is ever moved or renamed, the deployed check silently
    // goes blind in a checkout too — so the file is asserted to exist rather
    // than assumed.
    const { readFileSync } = await import('node:fs');
    expect(() => readFileSync(REPOSITORY_SENTINEL, 'utf8')).not.toThrow();
  });
});
