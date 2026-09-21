process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { describe, expect, it } from 'vitest';
import { theAperture } from '../../src/services/venture/the-aperture.js';
import { KINDS } from '../../src/services/venture/products/registry.js';
import { OFFER_BAND } from '../../src/services/venture/products/offer-composition.js';
import { BASE_TERMS, MARKERS } from '../../src/services/venture/discovery.js';

// =============================================================================
// THE FACTORY MUST NOT DEFINE THE OPPORTUNITY SPACE.
//
// Foundry can find one shape of problem - somebody complaining about their own
// repeated manual labour - and make one shape of answer to it, sold once for
// between five and forty-nine dollars. Everything it has ever reported came
// through that. An institution that reports "I looked and found nothing better"
// when the truth is "nothing better was eligible to be looked at" has told its
// owner something false about the world while every individual number on the
// page is correct.
//
// AN OBSERVED ZERO IS NOT AN UNMEASURED QUANTITY. That is the whole test.
// =============================================================================

describe('the shape of the aperture, derived and not written down', () => {
  it('reports the search seeds and triage markers that are actually used', () => {
    const a = theAperture();
    // NOT A SECOND COPY OF THEM. If somebody adds a sixth seed phrase or an
    // eleventh marker, this moves with it - a hand-kept list of blind spots is
    // accurate on the day it is written and quietly wrong afterwards.
    expect(a.looksFor).toEqual(BASE_TERMS);
    expect(a.hearsOnly).toEqual(MARKERS.map((m) => m.kind));
    expect(a.band).toBe(OFFER_BAND);
  });

  it('reads the makeable and unmakeable forms from the registry itself', () => {
    const a = theAperture();
    expect(a.canMake.map((k) => k.kind)).toEqual(['data_brief']);
    expect(a.cannotMake.map((k) => k.kind).sort())
      .toEqual(['directory', 'monitoring_alert', 'static_tool', 'template_file']);
    // AND EACH ONE QUOTES THE REGISTRY'S OWN ACCOUNT OF WHAT IS MISSING,
    // written by whoever decided not to build it. The day somebody builds one,
    // this stops claiming it is missing, without anybody editing this file.
    for (const k of KINDS.filter((x) => !x.canMake)) {
      expect(a.unseen.some((u) => u.wouldNeed === k.needs)).toBe(true);
    }
  });

  it('never describes an unseen opportunity as one that was judged', () => {
    const a = theAperture();
    expect(a.unseen.length).toBeGreaterThan(0);
    for (const u of a.unseen) {
      expect(['never_searched_for', 'no_form_to_make_it', 'outside_the_band'])
        .toContain(u.kind);
      // The reason is always a fact about this institution, never a fact about
      // the opportunity. "Nobody would buy it" is not available here.
      expect(u.because).toBeTruthy();
      expect(u.wouldNeed).toBeTruthy();
      expect(/\bnot worth\b|\bnobody would\b|\bpoor\b|\bweak\b/i.test(u.because)).toBe(false);
    }
    expect(a.sentence).toContain('not because they were judged and found wanting');
    expect(a.sentence).toContain('a limit of the machine, not a finding about the world');
  });

  it('names a price ceiling and a recurring shape as limits of the till', () => {
    const a = theAperture();
    const band = a.unseen.filter((u) => u.kind === 'outside_the_band');
    expect(band).toHaveLength(2);
    expect(band[0]?.what).toContain(`$${String(OFFER_BAND.highDollars)}`);
    expect(band.some((u) => u.what.includes('repeatedly'))).toBe(true);
    // AND IT SAYS WHY THE BAND IS NARROW RATHER THAN TREATING IT AS ARBITRARY.
    // A wider band is a larger promise, and a larger promise is a larger thing
    // owed when it fails.
    expect(band[0]?.wouldNeed).toContain('what is owed');
  });
});

// =============================================================================
// THE COVERAGE EXERCISE, run offline over forms outside the dominant recipe.
//
// Seven shapes of small digital income, including weak ones. For each, the only
// question asked here is the one that was never asked before: if Foundry did
// not pursue this, was that an ECONOMIC judgement or a PRODUCTION LIMIT? The
// answer today is "production limit" for every single one, and that is the
// finding - not that these are good businesses, which nothing here claims.
// =============================================================================

const FORMS: Array<{ form: string; wouldBe: string; reachable: boolean }> = [
  { form: 'a static calculator somebody uses once and pays for', wouldBe: 'static_tool', reachable: true },
  { form: 'a licensed component another builder embeds', wouldBe: 'static_tool', reachable: false },
  { form: 'a periodically updated data product people re-buy', wouldBe: 'directory', reachable: true },
  { form: 'an existing small utility bought outright', wouldBe: 'directory', reachable: false },
  { form: 'a distribution relationship that resells somebody else\'s thing', wouldBe: 'directory', reachable: false },
  { form: 'a narrow monitoring service on one watched source', wouldBe: 'monitoring_alert', reachable: true },
  { form: 'a spreadsheet template for one recurring job', wouldBe: 'template_file', reachable: true },
];

describe('the coverage exercise: economic rejection, or a production limit', () => {
  it('finds that not one of seven forms was rejected on economic grounds', () => {
    const a = theAperture();
    const makeable = new Set(a.canMake.map((k) => k.kind as string));
    const verdicts = FORMS.map((f) => ({
      ...f,
      why: makeable.has(f.wouldBe) ? 'economic' : 'production limit',
      needs: KINDS.find((k) => k.kind === f.wouldBe)?.needs ?? null,
    }));

    // EVERY ONE. Whatever their merits, none of these was ever weighed.
    expect(verdicts.every((v) => v.why === 'production limit')).toBe(true);
    expect(verdicts.every((v) => v.needs !== null)).toBe(true);

    // AND THE WEAK ONES ARE STILL PRODUCTION LIMITS, which is the point that
    // makes this exercise worth running. It would be comfortable to conclude
    // that the aperture happens to exclude only bad ideas. It excludes them
    // the same way it excludes the good ones: before anybody looked.
    const weak = verdicts.filter((v) => !v.reachable);
    expect(weak).toHaveLength(3);
    expect(weak.every((v) => v.why === 'production limit')).toBe(true);
  });

  it('does not let a blocked form be counted as a judged candidate', () => {
    // The institution may not say "I considered seven and none was worth it".
    // It has considered none of them.
    const a = theAperture();
    expect(a.unseen.filter((u) => u.kind === 'no_form_to_make_it'))
      .toHaveLength(KINDS.filter((k) => !k.canMake).length);
  });

  it('would stop claiming a form is missing the day it can be made', () => {
    // The guard on the derivation itself: `theAperture` reads `KINDS`, so a
    // registry where everything is makeable reports no missing form. Proved by
    // reading the relationship rather than by mutating a constitutional list.
    const a = theAperture();
    expect(a.unseen.filter((u) => u.kind === 'no_form_to_make_it').length)
      .toBe(KINDS.length - a.canMake.length);
  });
});
