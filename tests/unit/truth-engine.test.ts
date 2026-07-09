// =============================================================================
// Tests: Truth engine (Ascent A3 / Honesty Law)
// Deterministic claim-vs-source verification: strict on numbers, forgiving on
// phrasing, and every verification names its evidence.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { tokenizeClaim, verifyClaim, auditClaims } from '../../src/services/truth/engine.js';

const SOURCES = [
  { name: 'billing', content: 'tierPricing = { solo: 79, growth: 199, investor_ready: 399 }' },
  { name: 'metrics', content: 'churn_rate 0.042 measured over 30 days, 128 active customers' },
];

describe('tokenizeClaim', () => {
  it('extracts numbers (normalizing $ , %), quoted phrases, and significant words', () => {
    const t = tokenizeClaim('Churn fell to 4.2% after the "pricing change" — $1,299 saved');
    expect(t).toContain('4.2');
    expect(t).toContain('1299');
    expect(t).toContain('pricing change');
    expect(t).toContain('churn');
    expect(t).not.toContain('the');
  });
});

describe('verifyClaim', () => {
  it('verifies a claim whose every token is grounded, with named evidence', () => {
    const v = verifyClaim('Solo pricing at $79', SOURCES);
    expect(v.verified).toBe(true);
    expect(v.evidence.find((e) => e.token === '79')?.source).toBe('billing');
  });

  it('rejects a claim with an ungrounded NUMBER even when the words match', () => {
    const v = verifyClaim('Solo pricing at $89', SOURCES);
    expect(v.verified).toBe(false);
    expect(v.unmatchedTokens).toContain('89');
  });

  it('rejects invented facts wholesale', () => {
    const v = verifyClaim('Trusted by 5,000 enterprise teams', SOURCES);
    expect(v.verified).toBe(false);
    expect(v.unmatchedTokens).toContain('5000');
  });

  it('is forgiving on phrasing: hyphen/underscore variants match', () => {
    const v = verifyClaim('Investor-Ready pricing at $399', SOURCES);
    expect(v.verified).toBe(true); // investor-ready → investor + ready ⊂ investor_ready
  });
});

describe('auditClaims', () => {
  it('returns only the failures', () => {
    const failures = auditClaims(
      ['Growth tier costs $199', 'We have 9,999 customers'],
      SOURCES,
    );
    expect(failures.length).toBe(1);
    expect(failures[0].claim).toContain('9,999');
  });
});
