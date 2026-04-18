// =============================================================================
// Tests: Tier Gate — Feature Access Control
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  canAccess,
  FEATURE_GATES,
  getTierBadge,
  getTierCapabilities,
} from '../../src/middleware/tier-gate.js';
import type { Founder, SubscriptionTier } from '../../src/types/index.js';

/** Minimal founder factory for testing */
function makeFounder(tier: SubscriptionTier | null): Founder {
  return {
    id: 'test-founder-id',
    clerk_user_id: 'clerk_123',
    email: 'test@example.com',
    name: 'Test Founder',
    stripe_customer_id: null,
    tier,
    cohort_id: null,
    created_at: new Date().toISOString(),
    preferences: null,
    lifestyle_mode: false,
    lifestyle_target_mrr: null,
  };
}

describe('canAccess()', () => {
  describe('investor_ready tier — full access', () => {
    const founder = makeFounder('investor_ready');

    it('has access to all defined features', () => {
      for (const featureKey of Object.keys(FEATURE_GATES)) {
        expect(canAccess(founder, featureKey)).toBe(true);
      }
    });

    it('has access to unknown/undefined features (fail-open)', () => {
      expect(canAccess(founder, 'nonexistent_feature')).toBe(true);
    });
  });

  describe('growth tier — core + growth features only', () => {
    const founder = makeFounder('growth');

    const growthFeatures = [
      'audit', 'dashboard', 'decisions', 'lifecycle', 'digest',
      'integrations', 'team_mode', 'benchmarks', 'wisdom', 'remediation',
    ];
    const investorOnlyFeatures = [
      'investor_layer', 'playbooks', 'temporal', 'competitive', 'cohorts', 'story', 'multi_product',
    ];

    it('can access core and growth-tier features', () => {
      for (const feature of growthFeatures) {
        expect(canAccess(founder, feature)).toBe(true);
      }
    });

    it('cannot access investor-ready-only features', () => {
      for (const feature of investorOnlyFeatures) {
        expect(canAccess(founder, feature)).toBe(false);
      }
    });

    it('can access unknown features (fail-open)', () => {
      expect(canAccess(founder, 'future_feature')).toBe(true);
    });
  });

  describe('solo tier — core features only', () => {
    const founder = makeFounder('solo');

    const soloFeatures = ['audit', 'dashboard', 'decisions', 'lifecycle', 'digest'];
    const growthFeatures = ['integrations', 'team_mode', 'benchmarks', 'wisdom', 'remediation'];
    const investorFeatures = [
      'investor_layer', 'playbooks', 'temporal', 'competitive', 'cohorts', 'story', 'multi_product',
    ];

    it('can access core solo-tier features', () => {
      for (const feature of soloFeatures) {
        expect(canAccess(founder, feature)).toBe(true);
      }
    });

    it('cannot access growth-tier features', () => {
      for (const feature of growthFeatures) {
        expect(canAccess(founder, feature)).toBe(false);
      }
    });

    it('cannot access investor-ready-only features', () => {
      for (const feature of investorFeatures) {
        expect(canAccess(founder, feature)).toBe(false);
      }
    });

    it('can access unknown features (fail-open)', () => {
      expect(canAccess(founder, 'unknown_feature_xyz')).toBe(true);
    });
  });

  describe('null tier — no access to any gated features', () => {
    const founder = makeFounder(null);

    it('cannot access any defined features', () => {
      for (const featureKey of Object.keys(FEATURE_GATES)) {
        expect(canAccess(founder, featureKey)).toBe(false);
      }
    });

    it('can access unknown features (fail-open)', () => {
      expect(canAccess(founder, 'nonexistent_feature')).toBe(true);
    });
  });
});

describe('FEATURE_GATES configuration', () => {
  it('has non-empty requiredTier array for every feature', () => {
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      expect(gate.requiredTier.length, `${key} has empty requiredTier`).toBeGreaterThan(0);
    }
  });

  it('only contains valid tier values in requiredTier arrays', () => {
    const validTiers: SubscriptionTier[] = ['solo', 'growth', 'investor_ready'];
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      for (const tier of gate.requiredTier) {
        expect(validTiers, `${key} has invalid tier "${tier}"`).toContain(tier);
      }
    }
  });

  it('includes investor_ready in every feature requiredTier', () => {
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      expect(
        gate.requiredTier.includes('investor_ready'),
        `${key} is missing investor_ready from requiredTier`,
      ).toBe(true);
    }
  });

  it('has a name and description for every feature', () => {
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      expect(gate.name, `${key} missing name`).toBeTruthy();
      expect(gate.description, `${key} missing description`).toBeTruthy();
    }
  });

  it('has upgradeMessage for non-universal features', () => {
    for (const [key, gate] of Object.entries(FEATURE_GATES)) {
      // Features not available to all tiers should have an upgrade message
      if (!gate.requiredTier.includes('solo')) {
        expect(gate.upgradeMessage, `${key} missing upgradeMessage`).toBeTruthy();
      }
    }
  });

  it('defines at least 15 features', () => {
    expect(Object.keys(FEATURE_GATES).length).toBeGreaterThanOrEqual(15);
  });
});

describe('getTierBadge()', () => {
  it('returns "Solo" for solo tier', () => {
    expect(getTierBadge('solo')).toBe('Solo');
  });

  it('returns "Growth" for growth tier', () => {
    expect(getTierBadge('growth')).toBe('Growth');
  });

  it('returns "Investor-Ready" for investor_ready tier', () => {
    expect(getTierBadge('investor_ready')).toBe('Investor-Ready');
  });

  it('returns "No Plan" for null tier', () => {
    expect(getTierBadge(null)).toBe('No Plan');
  });

  it('returns "No Plan" for unrecognized tier', () => {
    expect(getTierBadge('nonexistent' as any)).toBe('No Plan');
  });
});

describe('getTierCapabilities()', () => {
  it('returns all features for investor_ready', () => {
    const capabilities = getTierCapabilities('investor_ready');
    expect(capabilities.sort()).toEqual(Object.keys(FEATURE_GATES).sort());
  });

  it('returns empty array for null tier', () => {
    const capabilities = getTierCapabilities(null);
    expect(capabilities).toEqual([]);
  });

  it('returns solo-tier features only for solo', () => {
    const capabilities = getTierCapabilities('solo');
    // Solo should include core features but not growth/investor features
    expect(capabilities).toContain('audit');
    expect(capabilities).toContain('dashboard');
    expect(capabilities).not.toContain('integrations');
    expect(capabilities).not.toContain('investor_layer');
  });

  it('returns solo + growth features for growth', () => {
    const capabilities = getTierCapabilities('growth');
    expect(capabilities).toContain('audit');
    expect(capabilities).toContain('integrations');
    expect(capabilities).toContain('team_mode');
    expect(capabilities).not.toContain('investor_layer');
    expect(capabilities).not.toContain('playbooks');
  });

  it('growth capabilities are a superset of solo capabilities', () => {
    const soloCapabilities = getTierCapabilities('solo');
    const growthCapabilities = getTierCapabilities('growth');
    for (const cap of soloCapabilities) {
      expect(growthCapabilities, `growth missing solo capability: ${cap}`).toContain(cap);
    }
  });

  it('investor_ready capabilities are a superset of growth capabilities', () => {
    const growthCapabilities = getTierCapabilities('growth');
    const investorCapabilities = getTierCapabilities('investor_ready');
    for (const cap of growthCapabilities) {
      expect(investorCapabilities, `investor_ready missing growth capability: ${cap}`).toContain(cap);
    }
  });
});
