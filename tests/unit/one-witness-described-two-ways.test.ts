process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { reporterPhrase } from '../../src/services/institution/effect-outcome.js';

// =============================================================================
// ONE WITNESS, DESCRIBED TWO WAYS ON ONE PAGE.
//
// The same fact — who said an effect worked — had two treatments and neither
// was right. The disputed-effects card rendered the RAW string, so internal
// prefixes and a founder's own id reached the page. The assisting-activity line
// FLATTENED everything to a category, so "a system you connected told me"
// discarded which system, and a founder with three connected could not check
// the verdict against the right source.
//
// `external:` names are SELF-DECLARED. The ingest door states the rule they
// were captured under — "the origin the tool names for itself, never a claim
// about who it is; identity here is the token, this is provenance, not
// authority" — so rendering one as though Foundry had verified it would be the
// claim that door refuses to make. Quoting it as what the system calls itself
// keeps the provenance and the doubt together.
// =============================================================================

describe('a reporter reads as what it is', () => {
  it('the founder is "you", never their own identifier', () => {
    expect(reporterPhrase('founder:f_9c2a1b')).toBe('you');
    // The raw id used to reach the page on the disputed card. A founder does
    // not need to be shown their own primary key.
    expect(reporterPhrase('founder:f_9c2a1b')).not.toContain('f_9c2a1b');
  });

  it('the customer is named by what they did, because that is the fact', () => {
    expect(reporterPhrase('customer:wrote_again')).toBe('the customer, by writing again');
  });

  it('a connected system keeps the name it gave itself, quoted as self-declared', () => {
    const said = reporterPhrase('external:zendesk-webhook');
    expect(said).toContain('zendesk-webhook');
    expect(said).toMatch(/calling itself/);
    // Not asserted as identity: Foundry verified the token, not the name.
    expect(said).not.toMatch(/^zendesk-webhook/);
  });

  it('a system that did not say what it was is not given a name', () => {
    expect(reporterPhrase('external:unnamed_system'))
      .toBe('a system you connected that did not say what it was');
    expect(reporterPhrase('external:')).toMatch(/did not say what it was/);
  });

  it('an unrecognised shape says the least it can, rather than guessing', () => {
    expect(reporterPhrase('something_new:x')).toBe('somebody outside');
  });

  it('no internal prefix survives into anything a founder reads', async () => {
    for (const raw of ['founder:f_1', 'external:acme', 'customer:wrote_again', 'weird']) {
      const said = reporterPhrase(raw);
      expect(said).not.toContain('founder:');
      expect(said).not.toContain('external:');
      expect(said).not.toContain('customer:');
    }
  });
});

describe('both surfaces use it, so one witness is described one way', () => {
  it('the disputed card and the assisting line share the phrasing', async () => {
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../../scripts/lib/strip-comments.mjs');
    const letter = stripComments(
      readFileSync('src/routes/dashboard/letter.ts', 'utf8'), { lineComments: true });
    const assisting = stripComments(
      readFileSync('src/services/institution/responsibility-assisted-email.ts', 'utf8'),
      { lineComments: true });

    expect(letter).toContain('reporterPhrase(r.reporter)');
    // And the raw string is no longer rendered anywhere on the page.
    expect(letter).not.toMatch(/\$\{r\.reporter\}/);
    expect(assisting).toContain('reporterPhrase(');
  });
});
