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
//                             concluded nothing. BOTH READERS ARE NOW GONE:
//                             `investor-update.ts` went on 13 September 2026
//                             and `scp/investor/board-packet.ts` went with the
//                             unreachable estate, so the five cases here that
//                             exercised its `experimentOutcome` wording have
//                             been removed. The column keeps its lack of a
//                             writer; nothing reads it any more either.
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

import { describe, expect, it } from 'vitest';

describe('weekend mode can be reached', () => {
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
