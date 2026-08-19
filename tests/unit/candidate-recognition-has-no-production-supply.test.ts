// =============================================================================
// Tests: the candidate path is real, exercised, and has nothing feeding it.
//
// Four layers, in order:
//
//   an `operational_responsibility` reconstruction claim
//     → `discoverCandidatesFromReconstruction`
//       → `proposeResponsibilityCandidate`
//         → `responsibility_candidates`
//           → "Possible responsibilities requiring your judgment" on The Letter,
//              with promote and reject routes behind it.
//
// NOTHING IN PRODUCTION WRITES THE FIRST ONE. The predicate appears in exactly
// two places in `src/`: the reader that consumes it, and a benchmark that names
// it in a failure string. `discoverCandidatesFromReconstruction` has no caller
// in `src/` at all. So the section is invisible by construction, the two routes
// behind it cannot be reached, and the E3 recognition corpus supplies its own
// claims and drives the discovery itself.
//
// THIS IS NOT DELETED, and the reason matters. Retiring it is the same move
// migrations 163, 165 and 167 made — but those retired machinery nothing was
// proving anything with. This one carries an E3 evidence claim: the recognition
// benchmark scores whether Foundry recognises a responsibility from
// provenance-bearing claims, and deleting the machinery deletes the claim.
// Destroying evidence to tidy a diagram is not a refactor.
//
// Wiring it is not obviously right either. Something would have to PRODUCE
// `operational_responsibility` claims — Foundry inferring that a company has a
// responsibility from surrounding evidence — and the whole direction of
// migrations 126 and 135–138 is the opposite: a responsibility exists because
// the company said what it owes, not because Foundry inferred it. That is an
// owner's decision, recorded in the live frontier.
//
// So the unreachability is asserted, exactly as it was for the SaaS discovery
// map before that one was moved and deleted. If a producer ever appears, this
// fails — and that is good news somebody should notice rather than assume.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(dir = 'src', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const strip = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');

describe('the responsibility-candidate path has no production supply', () => {
  it('has no producer of the claim it reads', () => {
    // The reader is allowed to name the predicate; a WRITER is what would make
    // this live. `recordReconstructionClaim` is how any claim is written, so a
    // producer is a file that names the predicate and records a claim.
    const producers = sourceFiles().filter((f) => {
      const src = strip(readFileSync(f, 'utf8'));
      return /operational_responsibility/.test(src)
        && /recordReconstructionClaim\s*\(/.test(src);
    });
    expect(producers,
      `these now produce the claim candidates are discovered from: ${producers.join(', ')}`)
      .toEqual([]);
  });

  it('has no caller of the discovery it would need', () => {
    const callers = sourceFiles().filter((f) => {
      if (f.endsWith('institution/responsibility-candidate.ts')) return false; // defines it
      return /discoverCandidatesFromReconstruction\s*\(/.test(strip(readFileSync(f, 'utf8')));
    });
    expect(callers,
      `discovery is now driven from ${callers.join(', ')} — the section can fill, and this file is stale`)
      .toEqual([]);
  });

  it('shows the founder nothing rather than an empty promise', () => {
    // The saving grace, and the reason this is a recorded decision rather than
    // an urgent defect: the section renders only when there is something in it,
    // so a founder is never shown a heading over permanent emptiness.
    const letter = readFileSync('src/routes/dashboard/letter.ts', 'utf8');
    expect(letter).toMatch(/\$\{responsibilityCandidates\.length \? html`/);
  });
});
