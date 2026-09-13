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
// of twelve months' solvency. Below six it sent Beacon and Forge alerts at
// 'high' or 'critical' reading "Prism reports runway of X months".
//
// PRISM IS GONE, AND THE RULE IS NOT. The agent had no reachable caller once
// the Commercial Foundry routes went, and `beta_intake` — one of its three
// sources — had no writer left, so the module was deleted. The three cases that
// read its source went with it; there is no file to read.
//
// What stays is the half of this file that was never about Prism. Crucible
// carries the same rule three files away — "A MESSAGE THAT STATES A SCORE MUST
// HAVE ONE", written after `domain_health_score ?? 50` sent Compass a quality
// alert naming a number nothing produced. It was arrived at there, brought here
// second, and it is the surviving statement of the rule: if Crucible's guard is
// ever loosened back to a default, nothing else in the tree would object.
// =============================================================================

describe('a score is stated only when something stated it', () => {
  it('keeps the neighbour that learned this first', () => {
    const crucible = stripComments(readFileSync(
      resolve(import.meta.dirname, '../../src/services/scp/agents/crucible.ts'), 'utf8'));
    expect(/domain_health_score\s*\?\?\s*\d/.test(crucible),
      'crucible has regressed to a default score').toBe(false);
    expect(/qualityScore\s*!=\s*null/.test(crucible)).toBe(true);
  });
});
