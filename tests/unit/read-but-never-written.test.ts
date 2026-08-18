// =============================================================================
// Tests: two columns something read and nothing ever wrote
//
// The mirror of "a value the column cannot hold": a column that is SELECTed,
// rendered and branched on, and that no INSERT or UPDATE anywhere — in
// TypeScript or in a trigger — ever sets. It reads as a feature and behaves as
// an absence.
//
//   experiments.learnings     both investor documents SELECT it as the
//                             experiment's outcome. Concluding an experiment
//                             writes `winner`, `results_json` and
//                             `early_stop_reason`; `learnings` has no writer.
//                             So the Experiments section of a board packet and
//                             of an investor update has always listed names
//                             against a NULL outcome, and the model then wrote
//                             about a quarter of experiments that apparently
//                             concluded nothing.
//
//   products.cadence_mode     migration 070 describes weekend mode — "drops
//                             agent cadences for the side-project founder
//                             segment" — and the scheduler enforces it,
//                             clamping every cadence to weekly. Nothing set it:
//                             no toggle, no onboarding question, no API. A rule
//                             written, enforced and unreachable is, from the
//                             founder's side, indistinguishable from one that
//                             does not exist.
//
// The probe that found them also produced 24 false positives — columns written
// through a runtime-built column list, or by a migration trigger the scan
// cannot see. Recorded rather than built into a gate: a check with that much
// noise teaches people to ignore it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { experimentOutcome } from '../../src/services/scp/investor/board-packet.js';
import { scheduleNextRun } from '../../src/services/scp/scheduler.js';

const OWNER = 'rw_owner';
const P = 'rw_product';

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [OWNER, 'clerk_rw', 'rw@test.local']);
  await query(
    `INSERT INTO products (id, name, owner_id, status) VALUES (?, 'Read Co', ?, 'active')`,
    [P, OWNER]);
  await query(
    `INSERT INTO agent_instances (id, product_id, agent_name, display_name, version)
     VALUES (?, ?, 'atlas', 'Atlas', 1)`, [nanoid(), P]);
});

describe('an experiment reports what it actually established', () => {
  it('names the winner', () => {
    expect(experimentOutcome({ status: 'completed', winner: 'treatment' }))
      .toContain('treatment');
  });

  it('says inconclusive rather than picking a side', () => {
    // An experiment whose arms did not separate says nothing about the
    // statement. Telling an investor it won or lost is the same overclaim the
    // hypothesis vocabulary was fixed to avoid.
    const out = experimentOutcome({ status: 'completed', winner: 'inconclusive' });
    expect(out).toContain('inconclusive');
    expect(out).not.toMatch(/won/);
  });

  it('reports an early stop with its reason', () => {
    expect(experimentOutcome({ status: 'stopped_early', early_stop_reason: 'guardrail breached' }))
      .toContain('guardrail breached');
  });

  it('falls back to the status rather than inventing an outcome', () => {
    expect(experimentOutcome({ status: 'running' })).toBe('running');
  });

  it('does not read a column nothing writes', async () => {
    const { readFileSync } = await import('fs');
    for (const file of ['board-packet.ts', 'investor-update.ts']) {
      const src = readFileSync(
        new URL(`../../src/services/scp/investor/${file}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
      expect(src, file).not.toMatch(/learnings\s+AS/);
    }
  });
});

describe('weekend mode can be reached', () => {
  async function nextRunGapHours(): Promise<number> {
    const row = (await query(
      `SELECT next_run_at FROM agent_instances WHERE product_id = ? AND agent_name = 'atlas'`,
      [P])).rows[0] as Record<string, unknown>;
    return (new Date(String(row.next_run_at)).getTime() - Date.now()) / 3_600_000;
  }

  it('runs at the requested cadence by default', async () => {
    await query(`UPDATE products SET cadence_mode = NULL WHERE id = ?`, [P]);
    await scheduleNextRun(P, 'atlas', 24);
    const gap = await nextRunGapHours();
    expect(gap).toBeGreaterThan(23);
    expect(gap).toBeLessThan(25);
  });

  it('clamps every cadence to weekly once weekend mode is set', async () => {
    // The enforcement was always here. What was missing was any way to turn it
    // on, which is the half that decides whether a founder ever sees it.
    await query(`UPDATE products SET cadence_mode = 'weekend' WHERE id = ?`, [P]);
    await scheduleNextRun(P, 'atlas', 24);
    const gap = await nextRunGapHours();
    expect(gap).toBeGreaterThan(167);
  });

  it('goes back to the standard pace when it is turned off', async () => {
    await query(`UPDATE products SET cadence_mode = 'standard' WHERE id = ?`, [P]);
    await scheduleNextRun(P, 'atlas', 24);
    expect(await nextRunGapHours()).toBeLessThan(25);
  });

  it('has a route that writes it', async () => {
    // The point of the batch: an enforcement with no door is unreachable. This
    // asserts the door exists and is the one the settings page posts to.
    const { readFileSync } = await import('fs');
    const routes = readFileSync(
      new URL('../../src/routes/dashboard/settings.ts', import.meta.url), 'utf8');
    expect(routes).toMatch(/post\('\/settings\/cadence-mode'/);
    expect(routes).toMatch(/UPDATE products SET cadence_mode/);
    expect(routes).toMatch(/action="\/settings\/cadence-mode"/);
  });
});
