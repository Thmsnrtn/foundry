import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// =============================================================================
// HIS INSTANCE SERVES ONLY HIS PRODUCT.
//
// Seventy-two routers of Commercial Foundry were mounted unconditionally on the
// owner's deployment — agents, boards, playbooks, fleet observatories, ambient
// layers, ROI dashboards. Not dormant: their navigation rendered on the advanced
// surface, two taps from his first screen, and every route answered.
//
// He may one day build Commercial Foundry using Private Foundry. Until then it
// is not to bog down the private instance. It is preserved in full — branch
// `archive/commercial-foundry`, and in git history forever — and his instance
// no longer serves it.
//
// This reads the composition root rather than booting it, because what matters
// is the shape of the decision: which mounts are inside the posture check and
// which are outside it.
// =============================================================================

const INDEX = readFileSync('src/index.ts', 'utf8');

/** The mounts that are only registered when this is not the owner's instance. */
function commercialBlock(): string {
  const start = INDEX.indexOf('if (!isPrivateOwnerInstance()) {');
  expect(start, 'the commercial mounts are gated').toBeGreaterThan(0);
  return INDEX.slice(start, INDEX.indexOf('\n}\n', start));
}

describe('what the owner\'s deployment mounts', () => {
  it('keeps everything his own product needs', () => {
    const gated = commercialBlock();
    for (const needed of ['letterRoutes', 'onboardingRoutes', 'settingsRoutes',
      'privacySettings', 'healthRoutes', 'authRoutes']) {
      expect(gated, `${needed} must stay mounted for the owner`)
        .not.toContain(`app.route('/', ${needed});`);
      expect(INDEX, `${needed} must be mounted at all`).toContain(needed);
    }
  });

  it('serves him none of the product it was built to replace', () => {
    const gated = commercialBlock();
    for (const gone of ['agentsDebate', 'fleetRoutes', 'boardPacket', 'ambientRoutes',
      'roiDashboard', 'playbookRoutes', 'decisionRoutes', 'investorRoutes']) {
      expect(gated, `${gone} must not be served on the owner's instance`)
        .toContain(gone);
    }
  });

  it('says where it went, so nobody has to guess', () => {
    expect(INDEX).toContain('archive/commercial-foundry');
    expect(INDEX).toContain('preserved in full');
  });

  it('carries the private surface through the one router that keeps it', () => {
    // foundryShellRoutes is mounted inside letterRoutes; if that mount ever
    // moved into the gated block, the owner's whole product would disappear
    // from his own instance.
    const letter = readFileSync('src/routes/dashboard/letter.ts', 'utf8');
    expect(letter).toContain("letterRoutes.route('/', foundryShellRoutes)");
    expect(commercialBlock()).not.toContain('letterRoutes');
  });
});
