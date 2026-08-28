process.env.TURSO_DATABASE_URL = 'file::memory:';

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity } from '../../src/services/system-identity.js';
import {
  BASELINE_LIVENESS_CHECK, LIVENESS_BASELINES, SCHEMA_SNAPSHOT_CHECK,
  compareBaselinesToReality, observeFoundryBaselineLiveness,
  observeFoundryRepositoryReality, parseBaselineEntries,
} from '../../src/services/foundry/self-observation.js';
import { getFailingSelfChecks } from '../../src/services/institution/development-observation.js';

/** The detail as it was actually recorded, not as the caller was told. */
const recordedDetail = async (signalId: string): Promise<string> => String(JSON.parse(String(((await query(
  'SELECT payload_json FROM signal_events WHERE id=?', [signalId],
)).rows[0] as Record<string, unknown>).payload_json)).detail);
import { availableDevelopmentChecks } from '../../src/services/institution/development-shadowing.js';

// =============================================================================
// One case is an anecdote; two with the same shape is a mechanism.
//
// The recursive path had exactly one observation, so everything downstream of
// it — the intake, the check vocabulary, the reader that puts a failing check
// in front of the founder — had only ever run on one input. This is the second,
// held to the same bar the first one set: a committed description of reality
// that drifts, deterministic, already enforced externally, and misleading a
// reader without changing behaviour when it is wrong.
//
// The point of the last two tests is that NOTHING downstream needed changing.
// =============================================================================

const LIVE = { entries: [], liveTables: [], liveColumns: [], fileLines: new Map<string, number>() };

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('oca_owner','oca_clerk','owner@example.com')", []);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('oca_prod','Anything At All','oca_owner')", []);
});

describe('what a baseline entry has to still name', () => {
  it('does not treat a comment or a blank line as an exemption', () => {
    const entries = parseBaselineEntries('b.txt', 'table', '# a header\n\nreal_table\n   \n# another\n  spaced_table  \n');
    expect(entries.map((e) => e.value)).toEqual(['real_table', 'spaced_table']);
    expect(entries.every((e) => e.baseline === 'b.txt' && e.kind === 'table')).toBe(true);
  });

  it('passes when every exemption still names something that exists', () => {
    expect(compareBaselinesToReality({
      ...LIVE,
      entries: [
        { baseline: 'docs/db/unread-tables-baseline.txt', kind: 'table', value: 'board_decks' },
        { baseline: 'docs/db/write-only-columns-baseline.txt', kind: 'column', value: 'board_decks.title' },
        { baseline: 'docs/db/unreachable-modules-baseline.txt', kind: 'module', value: 'src/a.ts' },
        { baseline: 'docs/db/id-tiebreak-baseline.txt', kind: 'source_line', value: 'src/a.ts:12' },
      ],
      liveTables: ['board_decks'], liveColumns: ['board_decks.title'],
      fileLines: new Map([['src/a.ts', 40]]),
    })).toMatchObject({ result: 'passed' });
  });

  it('reports a table, a column, a module and a line that are gone', () => {
    const gone = (entry: { kind: 'table' | 'column' | 'module' | 'source_line'; value: string }) =>
      compareBaselinesToReality({
        ...LIVE, entries: [{ baseline: 'docs/db/x-baseline.txt', ...entry }],
        liveTables: ['board_decks'], liveColumns: ['board_decks.title'],
        fileLines: new Map([['src/a.ts', 40]]),
      });

    expect(gone({ kind: 'table', value: 'dropped_table' })).toMatchObject({ result: 'failed' });
    expect(gone({ kind: 'column', value: 'board_decks.dropped_column' })).toMatchObject({ result: 'failed' });
    expect(gone({ kind: 'module', value: 'src/deleted.ts' })).toMatchObject({ result: 'failed' });
    // The file is there; the line the baseline recorded is past its end, so it
    // cannot be the offender the entry was written about.
    expect(gone({ kind: 'source_line', value: 'src/a.ts:41' })).toMatchObject({ result: 'failed' });
    expect(gone({ kind: 'source_line', value: 'src/a.ts:40' })).toMatchObject({ result: 'passed' });
    expect(gone({ kind: 'source_line', value: 'src/a.ts:0' })).toMatchObject({ result: 'failed' });
    expect(gone({ kind: 'source_line', value: 'src/a.ts' })).toMatchObject({ result: 'failed' });
  });

  it('names what went stale, and where the exemption is written down', () => {
    const out = compareBaselinesToReality({
      ...LIVE,
      entries: [{ baseline: 'docs/db/unread-tables-baseline.txt', kind: 'table', value: 'dropped_table' }],
      liveTables: ['board_decks'], liveColumns: [], fileLines: new Map(),
    });
    expect(out.detail).toContain('dropped_table');
    expect(out.detail).toContain('unread-tables-baseline.txt');
  });
});

describe('observing it against the real repository', () => {
  it('reads this repository and reports the truth about it', async () => {
    await establishSystemIdentity('foundry', 'oca_prod', 'test fixture');
    const outcome = await observeFoundryBaselineLiveness();

    // A test asserting only `passed` would also pass against an observer
    // hardcoded to say so, so the real population is exercised: every baseline
    // in the list is read and the entries are actually counted.
    expect(outcome).toMatchObject({ observed: true, productId: 'oca_prod', result: 'passed' });
    expect(LIVENESS_BASELINES.length).toBeGreaterThan(3);
    if (outcome.observed) {
      expect(outcome.observation.check).toBe(BASELINE_LIVENESS_CHECK);
      expect(await recordedDetail(outcome.observation.id)).toContain('baselined exemption');
    }
  });

  it('declines rather than reporting drift when the evidence cannot be gathered', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'oca-'));
    try {
      expect(await observeFoundryBaselineLiveness({ repositoryRoot: empty }))
        .toEqual({ observed: false, reason: 'baselines_unreadable' });
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it('observes a stale exemption in a repository that has one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oca-'));
    try {
      mkdirSync(join(root, 'docs/db'), { recursive: true });
      for (const baseline of LIVENESS_BASELINES) {
        writeFileSync(join(root, baseline.path),
          baseline.path.endsWith('unread-tables-baseline.txt') ? '# header\na_table_nobody_created\n' : '');
      }
      const outcome = await observeFoundryBaselineLiveness({ repositoryRoot: root });
      expect(outcome).toMatchObject({ observed: true, result: 'failed' });
      if (outcome.observed) expect(await recordedDetail(outcome.observation.id)).toContain('a_table_nobody_created');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('nothing downstream had to learn about it', () => {
  it('offers both checks to an owner choosing what to watch', async () => {
    await observeFoundryRepositoryReality();
    await observeFoundryBaselineLiveness();
    expect(await availableDevelopmentChecks('oca_prod'))
      .toEqual([BASELINE_LIVENESS_CHECK, SCHEMA_SNAPSHOT_CHECK].sort());
  });

  it('puts the failing one in front of the founder, and not the passing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'oca-'));
    try {
      mkdirSync(join(root, 'docs/db'), { recursive: true });
      for (const baseline of LIVENESS_BASELINES) {
        writeFileSync(join(root, baseline.path),
          baseline.path.endsWith('unread-tables-baseline.txt') ? 'a_table_nobody_created\n' : '');
      }
      await observeFoundryBaselineLiveness({ repositoryRoot: root, observedAt: new Date() });

      // `getFailingSelfChecks` was written for one check and took the latest
      // observation per check. It needed no change to see a second.
      const failing = await getFailingSelfChecks('oca_prod');
      expect(failing.map((f) => f.check)).toEqual([BASELINE_LIVENESS_CHECK]);
      expect(failing[0].detail).toContain('a_table_nobody_created');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
