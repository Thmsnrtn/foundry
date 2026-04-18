// =============================================================================
// Tests: Growth Stage Detection
// =============================================================================

import { describe, it, expect } from 'vitest';
import { getStageConfig, getStageStressorThresholds } from '../../src/services/lifecycle/stage-detection.js';

describe('getStageConfig', () => {
  it('returns pre_launch config with suppressed metric stressors', () => {
    const config = getStageConfig('pre_launch');
    expect(config.stage).toBe('pre_launch');
    expect(config.suppressedStressors).toContain('mrr_health_ratio');
    expect(config.suppressedStressors).toContain('churn_rate');
    expect(config.stressorThresholdMultiplier).toBe(2.0);
  });

  it('returns early_traction with relaxed thresholds', () => {
    const config = getStageConfig('early_traction');
    expect(config.stressorThresholdMultiplier).toBe(1.5);
    expect(config.digestFocus).toContain('Hypothesis');
  });

  it('returns growth with standard thresholds', () => {
    const config = getStageConfig('growth');
    expect(config.stressorThresholdMultiplier).toBe(1.0);
  });

  it('returns scale with tighter thresholds', () => {
    const config = getStageConfig('scale');
    expect(config.stressorThresholdMultiplier).toBe(0.8);
  });

  it('returns mature with suppressed growth stressors', () => {
    const config = getStageConfig('mature');
    expect(config.suppressedStressors).toContain('slow_growth');
    expect(config.suppressedStressors).toContain('flat_mrr');
  });
});

describe('getStageStressorThresholds', () => {
  it('pre_launch has doubled thresholds', () => {
    const t = getStageStressorThresholds('pre_launch');
    expect(t.mrrHealthRatioCritical).toBe(2.0);
    expect(t.cohortRetentionDeviation).toBe(50);
    expect(t.activationRateDrop).toBe(20);
  });

  it('growth has standard thresholds', () => {
    const t = getStageStressorThresholds('growth');
    expect(t.mrrHealthRatioCritical).toBe(1.0);
    expect(t.mrrHealthRatioElevated).toBe(0.8);
    expect(t.cohortRetentionDeviation).toBe(25);
    expect(t.activationRateDrop).toBe(10);
  });

  it('scale has tighter thresholds', () => {
    const t = getStageStressorThresholds('scale');
    expect(t.mrrHealthRatioCritical).toBe(0.8);
    expect(t.activationRateDrop).toBe(8);
  });
});
