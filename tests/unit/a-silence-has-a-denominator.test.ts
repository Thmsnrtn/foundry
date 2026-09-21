// =============================================================================
// A SILENCE HAS A DENOMINATOR.
//
// "Nobody bought" is a true sentence about nineteen people and a much weaker
// sentence about the world than it sounds. The institution had been careful to
// scope its claims — this offer, that population, that channel, that window —
// and then stated them without ever saying how many people that was. A reader
// who is not used to the arithmetic of small numbers will hear a result about
// a market; zero out of nineteen is consistent with a real purchase rate of
// one buyer in seven.
//
// AN OBSERVED ZERO IS NOT AN UNMEASURED QUANTITY. The sentence added here says
// what the instrument could not have DETECTED, which is the missing half of
// every null result this institution has produced.
//
// AND IT IS NOT A CONFIDENCE SCORE. One sentence, carrying the count and an
// ordinary one-sided bound, saying nothing about whether the idea is good.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { describe, expect, it } from 'vitest';
import { couldNotHaveSeen, outcomeFromRow } from '../../src/services/founder/what-happened.js';
import { EXPERIMENT_001_IN_THE_WORLD } from '../helpers/world.js';

const settled = (reached?: number) => outcomeFromRow({
  ran_at: '2026-09-19T00:00:00Z', verdict: 'surprised', grade: 'surprised',
  what_happened: 'nobody bought', placed: true, reached,
});

describe('what a silence this size could not have ruled out', () => {
  it('reads the bound off the number of people who actually received it', () => {
    // Nineteen delivered of twenty-one written, which is Experiment 001's own
    // shape. The bound is `1 - 0.05^(1/19)` ≈ 0.146, or about one in seven.
    const s = couldNotHaveSeen(EXPERIMENT_001_IN_THE_WORLD.delivered)!;
    expect(s).toContain('19 people received it');
    expect(s).toContain('one buyer in 7');
    expect(s).toContain('about one time in twenty');
  });

  it('gets weaker as the sample gets smaller, and stronger as it grows', () => {
    // The whole point: the same silence means different things at different
    // sizes, and the sentence has to move with the number or it is decoration.
    const of = (n: number) => /one buyer in (\d+)/.exec(couldNotHaveSeen(n)!)![1];
    expect(Number(of(5))).toBeLessThan(Number(of(19)));
    expect(Number(of(19))).toBeLessThan(Number(of(100)));
    expect(Number(of(100))).toBeLessThan(Number(of(1000)));
  });

  it('says nothing at all rather than something meaningless', () => {
    expect(couldNotHaveSeen(0)).toBeNull();
    expect(couldNotHaveSeen(-1)).toBeNull();
    expect(couldNotHaveSeen(Number.NaN)).toBeNull();
    // One person is a real denominator and the bound is honest about it: a
    // silence from one person rules out almost nothing.
    expect(couldNotHaveSeen(1)).toContain('1 person received it');
  });

  it('is a limit, not a score', () => {
    const s = couldNotHaveSeen(19)!;
    // NOTHING HERE MAY READ AS A VERDICT ON THE IDEA. It is about the
    // instrument's reach, and a percentage or a grade would invite it to be
    // read as the institution's opinion of the market.
    expect(/%|score|confidence|likely|probably|weak|strong/i.test(s)).toBe(false);
  });
});

describe('the claim carries it', () => {
  it('puts the denominator in what the result establishes', () => {
    const o = settled(19);
    expect(o.establishes).toContain('did not sell');
    expect(o.establishes).toContain('19 people received it');
  });

  it('says nothing about size when the rows are not to hand', () => {
    // The denominator is optional, and an absent one must produce silence
    // rather than a guess — a surface that does not read the count is not a
    // surface entitled to imply one.
    const o = settled(undefined);
    expect(o.establishes).toContain('did not sell');
    expect(o.establishes).not.toContain('received it');
  });

  it('leaves what the result does not establish where it was', () => {
    // The size belongs to the CLAIM, not to the list of limits: it is a fact
    // about what was measured, and burying it among the caveats is how it gets
    // read past.
    const o = settled(19);
    expect(o.doesNotEstablish).toContain('that the category is worthless');
    expect(o.doesNotEstablish).not.toContain('received it');
  });
});

describe('a surprised result is not always a silence', () => {
  it('says nothing about size when somebody actually bought', () => {
    // `surprised` is not a zero-purchase verdict. `outcome.ts` writes it
    // whenever the kill number is breached, so a test disproved by one extra
    // delivery can take a sale on day five and still settle surprised. Gating
    // the zero-events bound on the WORD narrowed the defect and did not close
    // it; the count is the only thing that makes the sentence true.
    const o = outcomeFromRow({
      ran_at: '2026-09-19T00:00:00Z', verdict: 'surprised', grade: 'surprised',
      what_happened: 'the kill number was breached before anybody paid',
      placed: true, reached: 26, purchases: 1,
    });
    expect(o.establishes).toContain('did not sell');
    expect(o.establishes).not.toContain('received it');
    expect(o.establishes).not.toContain('silence');
  });

  it('still carries it when nobody bought', () => {
    const o = outcomeFromRow({
      ran_at: '2026-09-19T00:00:00Z', verdict: 'surprised', grade: 'surprised',
      what_happened: 'nobody bought', placed: true, reached: 19, purchases: 0,
    });
    expect(o.establishes).toContain('19 people received it');
  });
});
