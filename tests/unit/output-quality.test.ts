// =============================================================================
// Tests: Output-quality invariants (regression guards from the taste check)
// The golden-output harness surfaced real quality bugs by human eyeballing
// (raw fractions, grammar agreement, form-dump briefs). This turns those
// findings into MACHINE-checkable guards so the class can never silently
// return — the durable half of the taste check.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect } from 'vitest';
import { adviceFooter } from '../../src/services/ux/fluency.js';

// The hypothesis, brief, check-in and referral-ask guards went with the four
// departments that drafted them, deleted in Roadmap 2027 R10.

describe('the advice disclaimer never forks silent', () => {
  it('every fluency carries the not-advice line', () => {
    for (const f of ['plain', 'balanced', 'technical'] as const) {
      expect(adviceFooter(f)).toMatch(/not financial, legal, or tax advice/i);
    }
  });
});
