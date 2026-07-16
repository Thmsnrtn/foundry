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
import { deriveHypothesis } from '../../src/services/departments/product.js';
import { draftContentBrief } from '../../src/services/departments/marketing.js';
import { draftCheckIn } from '../../src/services/departments/success.js';
import { draftReferralAsk } from '../../src/services/departments/outreach.js';
import { adviceFooter } from '../../src/services/ux/fluency.js';

describe('rate metrics never leak a raw fraction to a human surface', () => {
  it('the product hypothesis premise shows % for rate metrics, not 0.xx', () => {
    // activation 0.34 → target ~0.39, must render "39%" not "0.39".
    const h = deriveHypothesis({ activation_rate: 0.34 });
    expect(h?.premise).toMatch(/\d+%/);
    expect(h?.premise).not.toMatch(/\b0\.\d+/); // no bare fraction in the human text
    // churn hypothesis too.
    const c = deriveHypothesis({ churn_rate: 0.09 });
    expect(c?.premise).toMatch(/\d+(\.\d+)?%/);
    expect(c?.premise).not.toMatch(/\b0\.\d+/);
    // but the stored threshold stays the raw fraction the kernel monitors.
    expect(h?.threshold).toBeLessThan(1);
  });
});

describe('the marketing brief is directive prose, not a form dump', () => {
  it('reads as sentences a writer can act on, grounded in real DNA', () => {
    const brief = draftContentBrief({
      icp_description: 'ops leads at 20-100 person B2B SaaS',
      icp_pain: 'drowning in manual reporting',
      positioning_statement: 'the reporting layer that assembles itself',
    });
    expect(brief.grounded).toBe(true);
    // Prose: full sentences (ends with a period), not "Field: value" lines.
    expect(brief.brief).toMatch(/\.\s|\.$/);
    expect(brief.brief).not.toMatch(/^Audience:|^Angle:|^Lead with the pain:/m);
    // Still grounded in the real field values.
    expect(brief.brief).toContain('ops leads at 20-100 person B2B SaaS');
  });

  it('thin DNA produces an honest nudge, never invented positioning', () => {
    const brief = draftContentBrief(null);
    expect(brief.grounded).toBe(false);
    expect(brief.brief).toMatch(/thin/i);
  });
});

describe('drafts contain no unfilled template placeholders', () => {
  it('a check-in and referral ask are fully rendered', () => {
    const checkIn = draftCheckIn({ name: 'Dan', last_active_at: new Date(Date.now() - 20 * 86_400_000).toISOString() }, 'Northwind');
    const ref = draftReferralAsk({ name: 'Priya' }, 'Northwind');
    for (const text of [checkIn.subject, checkIn.body, ref.subject, ref.body]) {
      expect(text).not.toMatch(/\{\{|\}\}|\$\{|undefined|null|\[object/); // no leaked placeholders
    }
    expect(checkIn.body).toContain('Dan');       // real name, not "there"
    expect(checkIn.body).toContain('Northwind'); // real product
  });

  it('a nameless customer degrades gracefully, not to "undefined"', () => {
    const checkIn = draftCheckIn({}, 'Northwind');
    expect(checkIn.body).toContain('Hi there,'); // graceful default
    expect(checkIn.body).not.toContain('undefined');
  });
});

describe('the advice disclaimer never forks silent', () => {
  it('every fluency carries the not-advice line', () => {
    for (const f of ['plain', 'balanced', 'technical'] as const) {
      expect(adviceFooter(f)).toMatch(/not financial, legal, or tax advice/i);
    }
  });
});
