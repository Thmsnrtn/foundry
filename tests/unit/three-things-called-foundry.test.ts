import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { LAYER_IN_PLAIN_WORDS, LAYER_OF, MAY_IMPORT, layerOf } from '../../src/lib/repository-layers.js';

// =============================================================================
// THREE THINGS CALLED FOUNDRY.
//
// The owner named the ambiguity: "Foundry" means his private institution, the
// source repository that constitutes it, and a commercial product that does
// not exist and may never. Private Foundry is about to begin developing its own
// source, and without a boundary "make my company experience better" and
// "improve the product other people would buy" become the same commit.
//
// THE ONE RULE THAT CARRIES THE WEIGHT: nothing may depend on `private`. If
// nothing is built on the owner's experience, then whatever a future Commercial
// Foundry consumes cannot be "whatever Private Foundry happens to look like" —
// it can only be the kernel, deliberately.
// =============================================================================

describe('the classification', () => {
  it('leaves nothing to depend on the owner\'s experience', () => {
    // The permission table read as English: only `private` and the composition
    // root may name `private`, and the composition root is what assembles a
    // deployment — which is exactly the act of choosing to include it.
    for (const [layer, allowed] of Object.entries(MAY_IMPORT)) {
      if (layer === 'private' || layer === 'composition') continue;
      expect(allowed, `${layer} must not be able to depend on the owner's experience`)
        .not.toContain('private');
    }
  });

  it('keeps the shared institution free of the commercial surface', () => {
    // A kernel that imports billing is a kernel that assumes there is something
    // to sell — the assumption `instance-posture` exists to undo at runtime.
    expect(MAY_IMPORT.kernel).not.toContain('commercial');
    expect(MAY_IMPORT.private).not.toContain('commercial');
  });

  it('classifies by longest prefix, so one file can differ from its folder', () => {
    // How `foundry-shell.ts` is the private product while fifty pages beside
    // it are not.
    expect(layerOf('src/routes/dashboard/foundry-shell.ts')).toBe('private');
    expect(layerOf('src/routes/dashboard/agents-okr.ts')).toBe('commercial');
    // SURFACES, NOT CAPABILITIES. Diagnosing a company's situation is something
    // any Foundry would want; only the shell that renders it is this owner's.
    // The gate taught this by refusing a kernel service that needed the
    // diagnosis, which is the boundary doing exactly what it is for.
    expect(layerOf('src/services/founder/what-situation.ts')).toBe('kernel');
    expect(layerOf('src/services/founder/situation-chain.ts')).toBe('kernel');
    expect(layerOf('src/services/institution/responsibility.ts')).toBe('kernel');
    expect(layerOf('src/services/billing/trial.ts')).toBe('commercial');
    expect(layerOf('src/db/client.ts')).toBe('substrate');
  });

  it('says what each layer is in words an owner can act on', () => {
    for (const layer of Object.keys(MAY_IMPORT)) {
      const words = LAYER_IN_PLAIN_WORDS[layer as keyof typeof LAYER_IN_PLAIN_WORDS];
      expect(words, layer).toBeTruthy();
      // No directory names, no layer keys: this is what he reads before
      // granting a permission to change his own source.
      expect(words).not.toMatch(/src\/|kernel'|\.ts/);
    }
    expect(LAYER_IN_PLAIN_WORDS.private).toContain('Nothing depends on it');
    expect(LAYER_IN_PLAIN_WORDS.commercial).toContain('kept, not');
    expect(LAYER_IN_PLAIN_WORDS.kernel).toContain('any \nfuture Foundry'.replace('\n', ''));
  });

  it('keeps the private product small on purpose', () => {
    // Most of what makes Private Foundry valuable is the institution, not the
    // interface. A private layer that grew to include the institution would be
    // the tangle this exists to prevent.
    const priv = Object.entries(LAYER_OF).filter(([, l]) => l === 'private');
    expect(priv.length).toBeGreaterThan(0);
    expect(priv.length).toBeLessThan(12);
    // Every one of them is a surface the owner opens, not a capability.
    for (const [path] of priv) expect(path).toContain('routes/');
  });
});

describe('the gate that keeps it true', () => {
  const run = (): { ok: boolean; out: string } => {
    try {
      return { ok: true, out: execFileSync('node', ['scripts/check-layer-boundary.mjs'],
        { encoding: 'utf8' }) };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  };

  it('holds right now', () => {
    const result = run();
    expect(result.out).toContain('0 depend on private');
    expect(result.ok).toBe(true);
  });

  it('fails when the shared institution starts depending on the owner\'s experience', () => {
    // A PLANTED DEFECT, because a gate nobody has watched fail is a gate nobody
    // knows works. This is the exact mistake the boundary exists to catch: a
    // kernel file importing the private shell.
    const planted = 'src/services/institution/_layer_fixture.ts';
    writeFileSync(planted,
      "import { foundryShellRoutes } from '../../routes/dashboard/foundry-shell.js';\n"
      + 'export const planted = foundryShellRoutes;\n');
    try {
      const result = run();
      expect(result.ok).toBe(false);
      expect(result.out).toContain('depends on the owner');
      // And it says so in the terms that matter, not in directory names.
      expect(result.out).toContain('never baselined');
    } finally {
      if (existsSync(planted)) unlinkSync(planted);
    }
  });

  it('fails when a file belongs to no layer at all', () => {
    // An unclassified file drifts into the kernel and quietly becomes part of
    // what a future Commercial Foundry would inherit.
    const planted = 'src/_layer_orphan.ts';
    writeFileSync(planted, 'export const orphan = 1;\n');
    try {
      const result = run();
      expect(result.ok).toBe(false);
      expect(result.out).toContain('belong to no layer');
    } finally {
      if (existsSync(planted)) unlinkSync(planted);
    }
  });

  it('reads its table from the module rather than restating it', () => {
    // One definition. A gate with its own copy would disagree with the runtime
    // about what this repository contains, and the runtime is what tells the
    // owner which of the three things he is changing.
    const gate = readFileSync('scripts/check-layer-boundary.mjs', 'utf8');
    expect(gate).toContain('src/lib/repository-layers.ts');
    expect(gate).toContain('tableBetween');
  });
});
