import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// =============================================================================
// "FIVE FOUNDERS LIKE YOU" MUST MEAN FIVE COMPANIES.
//
// `decisions/patterns.ts` documents this defect as fixed on its own reader, and
// exports the rule. Two other readers kept the row count:
//
//   • `intelligence/peer-signal.ts` — on the dashboard home, every load, no
//     consent gate. One company that made five similar decisions was presented
//     to its competitor as five peers.
//   • `intelligence/predictive.ts` — "N similar products saw negative
//     outcomes", where N was rows.
//
// The consent-gated reader is the careful one and is unreachable in production
// (`cross_company_patterns` is not in migration 041's CHECK, so it can never be
// granted). The ungated readers are the ones a founder actually sees. That is
// why counting correctly here mattered more than there.
//
// ONE OF THE TWO IS GONE. `intelligence/peer-signal.ts` was deleted as
// production-dead, and the five cases that drove `topPeerValidatedDecisionTypes`
// over real `decision_patterns` rows — a single company contributing five
// times, an unattributable row, the floor being reached honestly — went with
// it. There is no second implementation of the rule left to run against.
//
// What the rule needs from here is the thing that outlives any one reader:
// `predictive.ts` must take the floor from `decisions/patterns.ts` rather than
// keeping a third copy of the number, and must count contributors rather than
// rows. Both are read off the source, because the defect was never visible in
// the output — "five peers" reads the same either way.
// =============================================================================

describe('the reader that is left', () => {
  it('uses the one rule, not a third copy of it', () => {
    const file = 'intelligence/predictive.ts';
    const source = readFileSync(resolve(__dirname, `../../src/services/${file}`), 'utf8');
    expect(source, `${file} should import the shared floor`)
      .toContain('PEER_SIGNAL_MIN_SAMPLE');
    expect(source, `${file} should count distinct contributors`)
      .toContain('COUNT(DISTINCT contributor_hash)');
  });

  it('and the rule is still exported from the one place that owns it', () => {
    // `patterns.ts` re-exports the institution-wide contributor floor under
    // this name rather than declaring a number of its own — which is the point:
    // there is one floor, and every reader borrows it.
    const patterns = readFileSync(
      resolve(__dirname, '../../src/services/decisions/patterns.ts'), 'utf8');
    expect(patterns, 'a floor nobody can import is a floor everybody re-types')
      .toMatch(/export \{ PEER_SIGNAL_MIN_SAMPLE \}/);
    expect(patterns, 'and it is the institution floor, not a local constant')
      .toContain("from '../institution/contributor-floor.js'");
  });
});
