import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

// =============================================================================
// HIS INSTANCE SERVES ONLY HIS PRODUCT.
//
// Seventy-two routers of Commercial Foundry were mounted unconditionally on the
// owner's deployment — agents, boards, playbooks, fleet observatories, ambient
// layers, ROI dashboards. Not dormant: their navigation rendered on the advanced
// surface, two taps from his first screen, and every route answered.
//
// Then they were put behind a posture check, which stopped them being served
// and did not stop them existing: still imported, still type-checked, still
// crawled, and — the part that mattered — still the thing two test suites
// measured the repository against, so twenty-two thousand lines stayed alive
// for CI and for nobody else.
//
// On 13 September 2026 they were deleted. This file used to assert that the
// mounts were INSIDE the gate; it now asserts the stronger fact, which is that
// there is no gate and no mounts, because there are no modules. Preserved in
// full on branch `archive/commercial-foundry` and in history.
// =============================================================================

const INDEX = readFileSync('src/index.ts', 'utf8');

/** Named in the epitaph, and each one a file that must not come back quietly. */
const DELETED = [
  'src/routes/dashboard/agents.ts',
  'src/routes/dashboard/agents-debate.ts',
  'src/routes/dashboard/fleet.ts',
  'src/routes/dashboard/board-packet.ts',
  'src/routes/dashboard/ambient.ts',
  'src/routes/dashboard/roi.ts',
  'src/routes/dashboard/playbooks.ts',
  'src/routes/dashboard/decisions.ts',
  'src/routes/dashboard/investors.ts',
  'src/routes/api/platform.ts',
];

describe("what the owner's deployment mounts", () => {
  it('keeps everything his own product needs', () => {
    for (const needed of ['letterRoutes', 'onboardingRoutes', 'settingsRoutes',
      'privacySettings', 'healthRoutes', 'authRoutes']) {
      expect(INDEX, `${needed} must be mounted`).toContain(`app.route('/', ${needed});`);
    }
  });

  it('serves him none of the product it was built to replace, because none of it is here', () => {
    for (const gone of DELETED) {
      expect(existsSync(gone), `${gone} was deleted and must not return`).toBe(false);
    }
    for (const identifier of ['agentsDebate', 'fleetRoutes', 'boardPacket', 'ambientRoutes',
      'roiDashboard', 'playbookRoutes', 'decisionRoutes', 'investorRoutes', 'platformApiRoutes']) {
      expect(INDEX, `${identifier} must not be imported or mounted`).not.toContain(identifier);
    }
  });

  it('no longer carries a posture gate around mounts, because there are none to gate', () => {
    // THE COMPROMISE IS GONE, NOT WIDENED. An `if (!isPrivateOwnerInstance())`
    // around a list of mounts was the honest intermediate state; keeping it
    // after the deletion would leave a door for the next commercial router to
    // be added behind rather than decided about.
    expect(INDEX).not.toContain('if (!isPrivateOwnerInstance()) {');
  });

  it('says where it went, so nobody has to guess', () => {
    expect(INDEX).toContain('archive/commercial-foundry');
    expect(INDEX).toContain('9049f60e');
  });

  it('carries the private surface through the one router that keeps it', () => {
    // foundryShellRoutes is mounted inside letterRoutes; if that mount ever
    // moved or vanished, the owner's whole product would disappear from his
    // own instance.
    const letter = readFileSync('src/routes/dashboard/letter.ts', 'utf8');
    expect(letter).toContain("letterRoutes.route('/', foundryShellRoutes)");
    expect(INDEX).toContain("app.route('/', letterRoutes);");
  });
});
