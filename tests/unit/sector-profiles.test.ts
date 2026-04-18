// =============================================================================
// Tests: Sector Profile System
// =============================================================================

import { describe, it, expect } from 'vitest';
import { isFindingRelevant, buildEffectiveWeights, isValidSector, getRemediationTone, collectSuppressedFindings } from '../../src/services/audit/sector-profiles.js';
import { AUDIT_DIMENSION_WEIGHTS } from '../../src/types/index.js';

describe('isValidSector', () => {
  it('accepts valid sectors', () => {
    expect(isValidSector('b2b_saas')).toBe(true);
    expect(isValidSector('healthcare')).toBe(true);
    expect(isValidSector('marketplace')).toBe(true);
    expect(isValidSector('fintech')).toBe(true);
    expect(isValidSector('developer_tools')).toBe(true);
  });

  it('rejects invalid sectors', () => {
    expect(isValidSector('crypto')).toBe(false);
    expect(isValidSector('')).toBe(false);
    expect(isValidSector('HEALTHCARE')).toBe(false);
  });
});

describe('isFindingRelevant', () => {
  it('returns true for findings not in suppression list', () => {
    expect(isFindingRelevant('missing_error_handling', 'b2b_saas', [])).toBe(true);
  });

  it('suppresses findings in the override list', () => {
    expect(isFindingRelevant('hipaa_compliance', 'healthcare', ['hipaa_compliance'])).toBe(false);
  });

  it('suppresses education-specific findings', () => {
    expect(isFindingRelevant('no_monthly_billing', 'education', [])).toBe(false);
    expect(isFindingRelevant('no_credit_card_flow', 'education', [])).toBe(false);
    expect(isFindingRelevant('missing_free_trial', 'education', [])).toBe(false);
  });

  it('suppresses government-specific findings', () => {
    expect(isFindingRelevant('no_monthly_billing', 'government', [])).toBe(false);
    expect(isFindingRelevant('no_self_serve_signup', 'government', [])).toBe(false);
  });

  it('does not suppress standard findings for b2b_saas', () => {
    expect(isFindingRelevant('no_monthly_billing', 'b2b_saas', [])).toBe(true);
  });
});

describe('buildEffectiveWeights', () => {
  it('returns defaults when no overrides', () => {
    const result = buildEffectiveWeights(AUDIT_DIMENSION_WEIGHTS, []);
    expect(result).toEqual(AUDIT_DIMENSION_WEIGHTS);
  });

  it('applies weight overrides and normalizes', () => {
    const overrides = [{
      id: 'test', sector: 'healthcare', dimension: 'd5',
      weight_override: 0.25, passing_threshold_override: null,
      critical_findings_override: null, created_at: '', updated_at: '',
    }];
    const result = buildEffectiveWeights(AUDIT_DIMENSION_WEIGHTS, overrides);
    // D5 weight should be higher than default 0.15
    const d5Key = Object.keys(result).find(k => k.startsWith('d5_'))!;
    expect(result[d5Key]).toBeGreaterThan(AUDIT_DIMENSION_WEIGHTS[d5Key]!);
    // Total should sum to ~1.0
    const total = Object.values(result).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });
});

describe('collectSuppressedFindings', () => {
  it('returns empty array when no overrides', () => {
    expect(collectSuppressedFindings([])).toEqual([]);
  });

  it('collects all suppressed findings from overrides', () => {
    const overrides = [
      { id: '1', sector: 'healthcare', dimension: 'd5', weight_override: null, passing_threshold_override: null, critical_findings_override: ['hipaa_compliance'], created_at: '', updated_at: '' },
      { id: '2', sector: 'healthcare', dimension: 'd9', weight_override: null, passing_threshold_override: null, critical_findings_override: ['ato_fedramp'], created_at: '', updated_at: '' },
    ];
    const result = collectSuppressedFindings(overrides);
    expect(result).toContain('hipaa_compliance');
    expect(result).toContain('ato_fedramp');
    expect(result.length).toBe(2);
  });
});

describe('getRemediationTone', () => {
  it('returns plain_english for healthcare', () => {
    expect(getRemediationTone('healthcare')).toBe('plain_english');
  });

  it('returns plain_english for government', () => {
    expect(getRemediationTone('government')).toBe('plain_english');
  });

  it('returns encouraging for education', () => {
    expect(getRemediationTone('education')).toBe('encouraging');
  });

  it('returns encouraging for first-time founders', () => {
    expect(getRemediationTone('b2b_saas', 'first_time')).toBe('encouraging');
  });

  it('returns direct for serial founders', () => {
    expect(getRemediationTone('b2b_saas', 'serial')).toBe('direct');
  });

  it('returns standard by default', () => {
    expect(getRemediationTone('b2b_saas')).toBe('standard');
  });
});
