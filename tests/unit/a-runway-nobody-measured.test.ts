import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A RUNWAY NOBODY MEASURED, AND TWO AGENTS ASKED TO ACT ON IT.
//
// Prism read `parsed.runway_months ?? 12`. The model answering it is asked a
// PRODUCT question — "is the product getting closer to or further from what
// customers actually want?" — over `audit_scores`, `beta_intake` and
// `metric_snapshots`, none of which carries a financial figure. So the ordinary
// answer is no runway at all, and the fallback turned that silence into a claim
// of twelve months' solvency.
//
// Below six it sends Beacon and Forge alerts at 'high' or 'critical' reading
// "Prism reports runway of X months", asking two agents to reprioritise
// acquisition and revenue. Twelve was a number that happened to suppress those;
// a smaller default would have fired them for every company on the platform.
//
// Crucible carries the same rule three files away — "A MESSAGE THAT STATES A
// SCORE MUST HAVE ONE", written after `domain_health_score ?? 50` sent Compass
// a quality alert naming a number nothing produced. It was arrived at there and
// not brought here.
// =============================================================================

const prism = () => stripComments(
  readFileSync(resolve(import.meta.dirname, '../../src/services/scp/agents/prism.ts'), 'utf8'));

describe('a runway is stated only when something stated it', () => {
  it('does not substitute a number for a missing one', () => {
    const src = prism();
    expect(/runway_months\s*\?\?\s*\d/.test(src),
      'a default here is an invented solvency claim, not a fallback').toBe(false);
  });

  it('guards the runway condition on the value existing', () => {
    const src = prism();
    // The alerts must be unreachable when the model said nothing, rather than
    // reachable against a substituted number.
    expect(/runwayMonths\s*!=\s*null[^;]*runwayMonths\s*<\s*6/.test(src),
      'the runway alerts must be behind a null check').toBe(true);
  });

  it('still alerts when a runway IS stated and is short', () => {
    // The point is not to silence the alert — a real short runway is exactly
    // what two other agents should hear about. Only an unmeasured one is.
    const src = prism();
    expect(src).toContain("to_agent: 'beacon'");
    expect(src).toContain("to_agent: 'forge'");
    expect(/runwayMonths\s*<\s*3\s*\?\s*'critical'/.test(src),
      'the severity ladder for a real short runway is unchanged').toBe(true);
  });

  it('keeps the neighbour that learned this first', () => {
    // If Crucible's guard is ever loosened back to a default, this pair drifts
    // apart again and the next reader has no precedent to find.
    const crucible = stripComments(readFileSync(
      resolve(import.meta.dirname, '../../src/services/scp/agents/crucible.ts'), 'utf8'));
    expect(/domain_health_score\s*\?\?\s*\d/.test(crucible),
      'crucible has regressed to a default score').toBe(false);
    expect(/qualityScore\s*!=\s*null/.test(crucible)).toBe(true);
  });
});
