import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SNAPSHOT_PATH, LIVENESS_BASELINES } from '../../src/services/foundry/self-observation.js';

// =============================================================================
// A RECURSION THAT SHIPPED WITHOUT ITS EYES.
//
// Foundry-on-Foundry rests on one thing: an independent check of a reality
// Foundry does not get to narrate. That check reads
// `docs/db/schema.snapshot.sql` from the repository root, and baseline liveness
// reads the six baseline files beside it.
//
// The runtime image copied node_modules, dist, src/db/migrations, src/public
// and package.json. Not docs/. So in a deployed container the check returned
// `{observed:false, reason:'snapshot_unreadable'}` — honestly, which is the only
// reason this was survivable, but every single time. The scheduler would have
// fired every six hours against a company whose one observable fact was
// permanently unreadable, and Foundry-on-Foundry would have looked deployed and
// observed nothing.
//
// Local proof missed it because a working tree has docs/. The image is a
// different filesystem, and that difference is the whole defect.
// =============================================================================

const dockerfile = () => readFileSync(resolve(import.meta.dirname, '../../Dockerfile'), 'utf8');

/**
 * The paths the FINAL stage actually copies.
 *
 * Comments do not count, and the first version of this test learned that the
 * hard way: the explanation written directly above the fix mentioned
 * `docs/db`, so a substring search over the stage text passed with the COPY
 * line deleted. A test that its own comment can satisfy proves nothing.
 */
function copiedPaths(text: string): string[] {
  const i = text.lastIndexOf('FROM ');
  const stage = i === -1 ? text : text.slice(i);
  return stage.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^COPY\b/i.test(l))
    .flatMap((l) => l.replace(/^COPY\s+(--\S+\s+)*/i, '').split(/\s+/));
}

/** Is `dir` carried into the image by some COPY in the final stage? */
function imageCarries(text: string, dir: string): boolean {
  return copiedPaths(text).some((p) => p.replace(/^\/app\//, '').replace(/^\.\//, '').startsWith(dir));
}

describe('the runtime image contains what self-observation reads', () => {
  it('ships the schema snapshot the check compares against', () => {
    const dir = SNAPSHOT_PATH.slice(0, SNAPSHOT_PATH.lastIndexOf('/'));
    expect(imageCarries(dockerfile(), dir),
      `the runner stage never copies ${dir}, so ${SNAPSHOT_PATH} is absent at runtime`).toBe(true);
  });

  it('ships every baseline liveness reads', () => {
    for (const b of LIVENESS_BASELINES) {
      const dir = b.path.slice(0, b.path.lastIndexOf('/'));
      expect(imageCarries(dockerfile(), dir), `${b.path} is not in the runtime image`).toBe(true);
    }
  });

  it('derives the requirement from the module, not from a hardcoded list', () => {
    // If a new self-observation check starts reading a different directory,
    // this test must fail rather than keep passing on yesterday's paths.
    expect(SNAPSHOT_PATH.startsWith('docs/'),
      'the snapshot moved — re-derive what the image must carry').toBe(true);
    expect(LIVENESS_BASELINES.length,
      'baselines disappeared; this test is asserting nothing').toBeGreaterThan(0);
  });
});

// The Dockerfile is only half the question. A COPY cannot copy what never
// entered the build context, and `.dockerignore` excluded all of docs/ — so the
// first version of this fix would have FAILED THE BUILD, while this test
// passed, because it asserted the presence of a line rather than the effect of
// one. The two halves live in different files and only agree by being checked
// together.
function ignoredByDocker(path: string): boolean {
  const rules = readFileSync(resolve(import.meta.dirname, '../../.dockerignore'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  let excluded = false;
  for (const rule of rules) {
    const negated = rule.startsWith('!');
    const pattern = (negated ? rule.slice(1) : rule).replace(/\/$/, '');
    if (path === pattern || path.startsWith(`${pattern}/`)) excluded = !negated;
  }
  return excluded;
}

describe('the build context contains what the image copies', () => {
  it('does not exclude the schema snapshot from the build context', () => {
    expect(ignoredByDocker(SNAPSHOT_PATH),
      `.dockerignore excludes ${SNAPSHOT_PATH}, so the Dockerfile COPY of it cannot succeed`)
      .toBe(false);
  });

  it('does not exclude any baseline liveness reads', () => {
    for (const b of LIVENESS_BASELINES) {
      expect(ignoredByDocker(b.path), `.dockerignore excludes ${b.path}`).toBe(false);
    }
  });

  it('still keeps the rest of docs out of the image', () => {
    // The point was never to ship documentation. 308K of institutional prose in
    // a runtime image is not a capability.
    expect(ignoredByDocker('docs/foundry-institution/CONSTITUTION.md'),
      'the whole docs tree is being shipped — only docs/db is needed').toBe(true);
  });
});
