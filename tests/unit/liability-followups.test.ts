// =============================================================================
// Tests: Liability follow-ups (no-counsel code, 2026-07-14)
// The advice disclaimer surfaces AT THE POINT OF USE and never forks silent.
// The sender-of-record guard structurally refuses Foundry-as-sender to a third
// party (the clean-hands rule the live send path must call).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { adviceFooter } from '../../src/services/ux/fluency.js';
import { assertSenderOfRecord, isFoundryDomain, SenderOfRecordError } from '../../src/services/outbound/sender-of-record.js';

describe('advice disclaimer at the point of use', () => {
  it('is present at every fluency — the legal line never forks away', () => {
    for (const f of ['plain', 'balanced', 'technical'] as const) {
      const t = adviceFooter(f);
      expect(t.length).toBeGreaterThan(20);
      expect(t).toMatch(/not financial, legal, or tax advice/i);
    }
    // Plain/balanced lead with the "software, not an adviser" framing.
    expect(adviceFooter('plain')).toMatch(/software, not an adviser/i);
    // Technical is terse but still carries the disclaimer.
    expect(adviceFooter('technical')).toMatch(/informational software output/i);
  });
});

describe('sender-of-record guard (clean hands)', () => {
  it('identifies Foundry-owned domains, including subdomains', () => {
    expect(isFoundryDomain('Foundry <noreply@foundry.app>')).toBe(true);
    expect(isFoundryDomain('x@mail.foundry.dev')).toBe(true);
    expect(isFoundryDomain('founder@acme.com')).toBe(false);
    expect(isFoundryDomain('x@notfoundry.app.evil.com')).toBe(false);
  });

  it('a Foundry domain to a THIRD PARTY is refused', () => {
    expect(() => assertSenderOfRecord({ from: 'Foundry <noreply@foundry.app>', recipientIsFounder: false }))
      .toThrow(SenderOfRecordError);
  });

  it('a Foundry domain to the FOUNDER is fine (transactional)', () => {
    expect(() => assertSenderOfRecord({ from: 'Foundry <noreply@foundry.app>', recipientIsFounder: true }))
      .not.toThrow();
  });

  it("a founder's OWN connected sender to a third party is allowed", () => {
    expect(() => assertSenderOfRecord({ from: 'Acme <hello@acme.com>', recipientIsFounder: false }))
      .not.toThrow();
  });
});
