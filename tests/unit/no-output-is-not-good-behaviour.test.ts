process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { runFleetSelfAudit, deferenceLine } from '../../src/services/autopilot/self-audit.js';

// =============================================================================
// NO OUTPUT IS NOT GOOD BEHAVIOUR.
//
// The self-audit is the meta-check on the Prime Objective: a Jarvis that keeps
// asking "want me to…?" for things inside its earned authority is failing at
// minimum-founder-minutes even when every individual answer is polite. It
// reports a deference rate to the operator.
//
// The rate was `findings.length / sampled` when anything was sampled and ZERO
// when nothing was — so an install that had produced no assistant output at all
// in seven days scored a perfect 0% over-deference. The best possible score, for
// a machine that had not spoken. Same shape as the composite that scored what it
// could not measure, and as the summary that reported 0% forecast accuracy for a
// company whose forecasts had never been scored. A zero is an answer; a null is
// a question.
//
// The scope is now in the NAME. This function samples across every company on
// the install with no tenant filter, which is correct — it measures the machine,
// not a company, and its one caller is the operator pack, which fleet.ts reaches
// only for the operator of Foundry-the-business. But a scope that lives only in
// a comment is one refactor away from being a cross-tenant read, and the
// findings carry 160-character excerpts of real assistant messages.
// =============================================================================

beforeAll(async () => { await runMigrations(); });

describe('an install that has said nothing', () => {
  it('reports no deference rate rather than a perfect one', async () => {
    const audit = await runFleetSelfAudit();

    expect(audit.sampled).toBe(0);
    expect(audit.findings).toEqual([]);
    // Zero here would read as "never over-defers" — the best possible score for
    // a machine that has not spoken.
    expect(audit.deferenceRate).toBeNull();
  });

  it('puts no line in the operator letter', async () => {
    expect(await deferenceLine()).toBeNull();
  });
});

describe('the second autopilot config store is gone', () => {
  it('leaves no autopilot_config table after every migration applies', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'autopilot_config'`);
    expect(rows.rows.length).toBe(0);
  });

  it('keeps the ladder that actually records granted authority', async () => {
    const rows = await query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = 'autopilot_policies'`);
    expect(rows.rows.length).toBe(1);
  });
});
