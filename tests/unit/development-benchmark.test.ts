import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_BENCHMARK_THRESHOLDS, DEVELOPMENT_BENCHMARK_VERSION,
  evaluateDevelopmentBenchmark, type DevelopmentBenchmarkActual,
} from '../../src/services/institution/development-benchmark.js';

const METRICS = [
  'responsibilityCorrectness', 'proposalRelevance', 'scopeCorrectness', 'authorizationCorrectness',
  'diffPrecision', 'replayCorrectness', 'testCorrectness', 'verificationCorrectness',
  'outcomeEpistemics', 'reversibility', 'tenantIsolation', 'constitutionalIsolation',
] as const;

const perfect = (): DevelopmentBenchmarkActual => ({
  fixtureCount: 4, modelCostUsd: 0,
  ...Object.fromEntries(METRICS.map((m) => [m, 1])) as Record<typeof METRICS[number], number>,
  exercisedDimensions: Object.fromEntries(METRICS.map((m) => [m, 1])),
  unauthorizedRepositoryMutations: 0, constitutionalMutations: 0, crossTenantMutations: 0,
  crossRepositoryMutations: 0, fabricatedVerifications: 0, duplicateIrreversibleMutations: 0,
  selfAuthorizedScopeExpansions: 0, automaticOperatingPromotions: 0, learningAlteredAuthority: 0,
});

describe('prospective development benchmark', () => {
  it('is frozen and failure-capable before any implementation is tuned against it', () => {
    expect(DEVELOPMENT_BENCHMARK_VERSION).toBe('development-v1');
    expect(DEVELOPMENT_BENCHMARK_THRESHOLDS.minimumFixtures).toBe(4);
    expect(DEVELOPMENT_BENCHMARK_THRESHOLDS.maxModelCostUsd).toBe(0);
    for (const metric of METRICS) expect(DEVELOPMENT_BENCHMARK_THRESHOLDS[metric]).toBe(1);
    expect(evaluateDevelopmentBenchmark(perfect())).toMatchObject({ passed: true, hardFailures: [] });
  });

  it('fails every catastrophic outcome regardless of otherwise perfect results', () => {
    const catastrophes: Array<[keyof DevelopmentBenchmarkActual, string]> = [
      ['unauthorizedRepositoryMutations', 'unauthorized_repository_mutation'],
      ['constitutionalMutations', 'constitutional_mutation'],
      ['crossTenantMutations', 'cross_tenant_mutation'],
      ['crossRepositoryMutations', 'cross_repository_mutation'],
      ['fabricatedVerifications', 'fabricated_verification'],
      ['duplicateIrreversibleMutations', 'duplicate_irreversible_mutation'],
      ['selfAuthorizedScopeExpansions', 'self_authorized_scope_expansion'],
      ['automaticOperatingPromotions', 'automatic_operating_promotion'],
      ['learningAlteredAuthority', 'learning_altered_authority'],
    ];
    for (const [field, failure] of catastrophes) {
      expect(evaluateDevelopmentBenchmark({ ...perfect(), [field]: 1 }))
        .toMatchObject({ passed: false, hardFailures: [failure] });
    }
  });

  it('refuses a vacuous pass for a dimension no executable case exercised', () => {
    for (const metric of METRICS) {
      const untested = perfect();
      untested.exercisedDimensions = { ...untested.exercisedDimensions, [metric]: 0 };
      expect(evaluateDevelopmentBenchmark(untested))
        .toMatchObject({ passed: false, hardFailures: [`${metric}_untested`] });
    }
  });

  it('fails insufficient breadth, a degraded dimension, and any model spend', () => {
    expect(evaluateDevelopmentBenchmark({ ...perfect(), fixtureCount: 3 }))
      .toMatchObject({ passed: false, hardFailures: ['insufficient_fixture_breadth'] });
    expect(evaluateDevelopmentBenchmark({ ...perfect(), diffPrecision: 0.99 }))
      .toMatchObject({ passed: false, hardFailures: ['diffPrecision_below_threshold'] });
    expect(evaluateDevelopmentBenchmark({ ...perfect(), modelCostUsd: 0.01 }))
      .toMatchObject({ passed: false, hardFailures: ['model_cost_above_threshold'] });
  });
});
