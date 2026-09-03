process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// A SETTINGS TABLE NOBODY CAN REACH.
//
// `founder_focus_settings` held six controls over how Foundry paces itself for
// a founder: a focus area with an expiry, a vacation mode, a daily decision
// cap, a briefing format, a timezone.
//
// Nothing wrote a row — no settings page, no route, no API, no onboarding step
// could create one. Nothing read a column. What existed was a nightly job
// clearing expired focus areas and vacation modes: values no founder could ever
// have set.
//
// It is the exact shape migration 157 removed, and that job's own surviving
// comment says so about its sibling: the snooze sweep beside these two
// "deleted from `decision_snooze_log`, which nothing ever wrote a row into:
// there was no snooze button, no route and no API. A nightly job clearing an
// always-empty table is a moving part that describes a feature nobody has."
// The sibling was removed; this one was left.
//
// 157 also carries the owner decision that governs: "remove the consuming
// halves rather than build the producing ones. Anything genuinely wanted comes
// back as a whole feature, against a ledger that is actually populated."
//
// THE INTENT SURVIVES, which is why this is deletion and not lost work. Pacing
// Foundry to a founder's capacity is implemented in `ux/interruption.ts`, which
// reads measured strain from `wellbeing/pulse.ts` and quiets non-critical
// events one rung when a founder is strained and two when overloaded, under a
// ceiling they set. Same concern, against a signal something actually produces.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('the table is gone', () => {
  it('does not exist after migration', async () => {
    const rows = await query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='founder_focus_settings'");
    expect(rows.rows.length).toBe(0);
  });

  it('is named nowhere in the source', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk('src');
    const refs = files.filter((f) =>
      /founder_focus_settings/.test(stripComments(readFileSync(f, 'utf8'), { lineComments: true })));
    expect(refs, 'the sweep went with it').toEqual([]);
  });

  it('left no job behind that does nothing', () => {
    expect(Object.keys(JOB_REGISTRY)).not.toContain('scp_wellbeing_focus_cleanup');
    // A job that succeeds at doing nothing counts as healthy on the operator's
    // panel, which is its own small dishonesty.
    // The count moves whenever a job is deliberately added or removed, and it
    // is here to catch the accidental kind. `metric_snapshot` — the daily
    // placeholder writer whose empty rows four readers took for measurements —
    // was removed after the two ingest paths that depended on it were made to
    // upsert. Ninety, then eighty-nine, then eighty-eight. `reference_world_tick`
    // — which advances every reference company by one day through the public
    // metrics intake — makes eighty-nine again, deliberately.
    // And `sense_credential_tick` — which renews and probes the keys behind the
    // senses, so a connection that has gone dark is said out loud before
    // anything derived from it is shown — makes ninety.
    // `real_market_evidence_tick` — the first job that looks at the real world,
    // asking a public registry what already exists for each unexamined real
    // market claim — makes ninety-one. And `dependency_health_tick` — which
    // asks the same registry whether every package Foundry runs on is still
    // maintained, and lets the capability earn its reality proof from the
    // checked result — makes ninety-two.
    // And `contested_evidence_tick` — which proposes the cheapest reality test
    // where reading has stopped helping — makes ninety-three.
    expect(Object.keys(JOB_REGISTRY).length, 'ninety-two before, ninety-three now').toBe(93);
  });

  it('is off the write-only baseline rather than merely unreferenced', () => {
    expect(readFileSync('docs/db/write-only-columns-baseline.txt', 'utf8'))
      .not.toMatch(/founder_focus_settings/);
  });
});

describe('the concern it was for is still served', () => {
  it('by measured strain rather than an unreachable setting', () => {
    const src = stripComments(
      readFileSync('src/services/ux/interruption.ts', 'utf8'), { lineComments: true });
    expect(src, 'the pacing that founder_focus_settings described').toMatch(/getFounderPulse/);
    expect(src).toMatch(/pulse === 'strained'/);
    expect(src).toMatch(/pulse === 'overloaded'/);
  });

  it('reads a signal something actually produces', () => {
    const pulse = stripComments(
      readFileSync('src/services/wellbeing/pulse.ts', 'utf8'), { lineComments: true });
    expect(pulse, 'unlike the table, this is computed from real rows')
      .toMatch(/SELECT|FROM/);
  });
});
