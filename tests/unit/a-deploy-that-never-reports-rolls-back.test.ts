import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// A DEPLOY THAT NEVER REPORTS ROLLS BACK (Roadmap 2027 R3, 1 October 2026;
// EXECUTIVE_REVIEW R-2).
//
// The deploy already refused to call itself done until production reported
// this commit and every route the owner's screens post to. What it did not do
// was put anything back: a release that failed those questions stayed up, and
// the owner's own phone was the first to find out. Now the workflow reads the
// image production runs before it deploys, and when the release does not
// prove itself it redeploys that image and still ends red. Reading the image
// is never fatal; when it cannot be read the step says a failure will not roll
// back by itself.
//
// WHAT THIS DOES NOT PROVE. The steps are held in shape here; whether Fly's
// image reference reads as expected is proven only by the first real failure
// (evidence E1 until then). And a rollback restores code, not schema.
// =============================================================================

// The deploy job's steps, read as text: each starts at a `      - ` line, and a
// named step carries its `if:` and `run:` inside its own block. No YAML
// dependency for one file the test only has to read.
type Step = { name?: string; if?: string; run?: string };
const src = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/deploy-private.yml'), 'utf8');
const job = src.slice(src.indexOf('\n  deploy:'));
const blocks = job.split(/\n      - /).slice(1);
const steps: Step[] = blocks.map((b) => ({
  name: /^name: (.+)$/m.exec(b)?.[1]?.trim(),
  if: /^\s+if: (.+)$/m.exec(b)?.[1]?.trim(),
  run: b.includes('run: |') ? b.slice(b.indexOf('run: |')) : undefined,
}));
const at = (name: string): number => steps.findIndex((s) => s.name === name);

describe('before deploying', () => {
  it('remembers the image production runs now, and never fails the deploy for it', () => {
    const i = at('Remember the release that is running now');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(at('Deploy'));
    const run = steps[i]!.run ?? '';
    expect(run).toContain('flyctl image show --app foundry-intel --json');
    expect(run).toContain('PREV_IMAGE=');
    expect(run).toContain('|| true');
    expect(run).toContain('will NOT roll back by itself');
  });

  it('records only a Fly registry image, never whatever came back', () => {
    expect(steps[at('Remember the release that is running now')]!.run).toMatch(/case "\$prev" in\s+registry\.fly\.io\/\*\)/);
  });
});

describe('when the release does not prove itself', () => {
  const roll = steps[at('Roll back to the release that was running')];

  it('rolls back after both questions the release is asked', () => {
    expect(at('Roll back to the release that was running')).toBeGreaterThan(at('Report health'));
    expect(at('Roll back to the release that was running')).toBeGreaterThan(at('Ask the release whether it is there'));
  });

  it('runs only on failure, and only when there is something to put back', () => {
    expect(roll?.if).toBe("failure() && env.PREV_IMAGE != ''");
  });

  it('puts back the remembered image, and the run still ends red', () => {
    expect(roll?.run).toContain('--image "$PREV_IMAGE"');
    expect(roll?.run).toContain('--app foundry-intel');
    expect(roll?.run).toContain('echo "rolled back to $PREV_IMAGE"; exit 1');
  });
});
