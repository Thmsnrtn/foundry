process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// FOUNDRY MAY CREATE PRESENTATION. IT MAY NOT FABRICATE EVIDENCE.
//
// Three surfaces asserted things nobody observed:
//
//   • The network-intelligence page said "Observed across 38 similar
//     companies." The only writer of `cohort_patterns` is a seed with 38, 52,
//     44, 29 and 18 typed into the source, and it runs on first page load. Zero
//     companies were counted, and the reader is on a paid tier.
//   • The landing page headed an invented company's invented MRR "A Real
//     Briefing".
//   • `/case-studies` called machine-composed artifacts "Documented evidence
//     from real products, timestamped and verifiable", and the tier-gate sold
//     "cryptographic timestamps" for a `toISOString()`.
//
// The patterns and the example briefing are worth keeping — a prior and an
// illustration are legitimate. What is not legitimate is presenting either as
// something that happened.
//
// TWO OF THE THREE SURFACES NO LONGER EXIST. `routes/public/landing.ts` was
// deleted on 13 September 2026 — Private Foundry has no page of its own and
// apexmicro.ai is the public face — taking the example briefing and
// `/case-studies` with it. The checks that read that file are gone rather than
// pointed at a substitute: a claim cannot be made by a page that is not served.
// What survived was the half that was never on the page — the seeded patterns,
// which a paying reader still saw, and the tier-gate's timestamp copy.
//
// AND THE THIRD SURFACE HAS GONE TOO. `network/cohort-patterns.ts` held
// both the seed and `getCohortPatterns`, and was deleted as production-dead, so
// the describe that held the seeded rows to "a prior, not an observation" went
// with it — there is no seed left to label and no reader left to read it. What
// remains is the sentence the tier-gate and the story engine were selling,
// which is not about any one page: Foundry does not offer a cryptographic
// timestamp it does not compute.
//
// THE TIER-GATE IS NOW GONE AS WELL. `middleware/tier-gate.ts` held sixteen
// feature gates at three subscription prices, and one of them sold the
// timestamp. It was deleted with the rest of the commercial surface — the
// private owner is not on a plan and there is nothing to admit him to. So the
// check reads only the story engine, which still composes the artifact and is
// still the place the claim could reappear. The gate is not replaced by a
// substitute file: a claim cannot be made by code that is not there.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

describe('what is sold', () => {
  // Comments stripped: an explanatory note that QUOTES the old claim is not
  // the old claim, and a grep cannot tell them apart. Same instrument the
  // gates use.
  it('does not sell a cryptographic timestamp it does not compute', () => {
    const story = stripComments(readFileSync(resolve(ROOT, 'src/services/story/engine.ts'), 'utf8'));
    expect(story).not.toContain('Cryptographic timestamp');
  });
});
