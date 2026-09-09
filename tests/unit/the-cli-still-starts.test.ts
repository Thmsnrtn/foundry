// =============================================================================
// THE CLI STILL STARTS.
//
// Two commands were registered under the name `workshop:inbox` — one to set up
// forwarding, one added later to read what had arrived. Commander refuses a
// duplicate at registration, so the SECOND one did not shadow the first: it
// threw before `program.parse` was ever reached, and every command in the
// binary died with it. `workshop:stand-up-ears`, `probe:screen-001`,
// `job:run`, `db:status` — all of them, in production, for as long as it took
// somebody to try one.
//
// Nothing caught it. The typechecker cannot see it, no route touches it, and
// no test imported the module. It is exactly the shape of defect the
// institution keeps meeting: correct-looking code whose failure lives in a
// place no gate was looking.
//
// This reads the source rather than importing it, because importing the CLI
// registers commands and parses argv — the very thing that was broken.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(process.cwd(), 'src/cli/index.ts'), 'utf-8');

/** Every name the CLI registers, in the order it registers them. */
function commandNames(): string[] {
  return [...SOURCE.matchAll(/\.command\(\s*'([^'\s<[]+)/g)].map((m) => m[1]!);
}

describe('the CLI can be started at all', () => {
  it('registers every command exactly once', () => {
    const names = commandNames();
    expect(names.length).toBeGreaterThan(40);
    const seen = new Map<string, number>();
    for (const n of names) seen.set(n, (seen.get(n) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([name]) => name);
    // Commander throws on the duplicate, so this is not a shadowing bug — it is
    // every command in the binary refusing to run.
    expect(duplicated, `these names are registered more than once, which stops the whole CLI from starting:\n${duplicated.join('\n')}`)
      .toEqual([]);
  });

  it('names the commands this institution operates through, so a rename is a visible edit', () => {
    const names = new Set(commandNames());
    // The ones an owner or an operator actually reaches for. If one of these
    // disappears or is renamed, that should be a decision, not a surprise.
    for (const required of [
      'workshop:stand-up-ears', 'workshop:ears', 'workshop:post', 'workshop:answering',
      'workshop:answer-post', 'workshop:readiness', 'workshop:postal',
      'probe:screen-001', 'probe:short', 'job:run', 'job:list',
    ]) {
      expect(names.has(required), `${required} is gone from the CLI`).toBe(true);
    }
  });
});
