// =============================================================================
// THE ECONOMIC FORMS NAME THE FOUR QUESTIONS.
//
// Demand, distribution, conversion and fulfilment are four questions, and a
// test that answers one is routinely read as answering all four. The forms
// on the shelf now include the two the evidence names — a free resource
// supporting a paid product, and something licensed in — each with the
// exchange it would need; and every unknown is filed under the question it
// actually asks, from its own words, so "cheapest test" means cheapest for
// that question. Nothing here manufactures a candidate.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.NODE_ENV = 'test';

import { describe, expect, it } from 'vitest';
import { ECONOMIC_FORMS, formOf, fourQuestionsOf } from '../../src/services/venture/economic-forms.js';

describe('the two forms the evidence names', () => {
  it('a free resource supporting a paid product is a form, needing the free-with-role exchange', () => {
    const f = ECONOMIC_FORMS.find((x) => x.key === 'free_resource')!;
    expect(f).toBeDefined();
    expect(f.needsExchange).toEqual(['free_with_role']);
    expect(formOf([{ said: 'A free calculator that brings people to a paid brief', where: 'its headline' }]).form).toBe('free_resource');
    expect(formOf([{ said: 'a free tool for contractors, with the full report sold beside it', where: 'the problem it names' }]).form).toBe('free_resource');
  });

  it('something licensed in and resold is a form, needing the license exchange', () => {
    const f = ECONOMIC_FORMS.find((x) => x.key === 'licensed_in')!;
    expect(f).toBeDefined();
    expect(f.needsExchange).toEqual(['license']);
    expect(formOf([{ said: 'license the dataset from the register and resell it filtered', where: 'its headline' }]).form).toBe('licensed_in');
  });

  it('the older forms keep their words: a calculator is still a calculator, and nothing is invented for "other"', () => {
    expect(formOf([{ said: 'a bid calculator for shops', where: 'its headline' }]).form).toBe('calculator');
    expect(formOf([{ said: 'nothing recognisable here', where: 'its headline' }]).form).toBe('other');
  });
});

describe('every unknown is one of four questions', () => {
  it('reads the question from its own words', () => {
    expect(fourQuestionsOf('Will an independent Massachusetts millwork business pay $29 for filtered public-bid discovery at all?')).toBe('demand');
    expect(fourQuestionsOf('Can the shops that would pay be reached by cold email at all, or only through the register?')).toBe('distribution');
    expect(fourQuestionsOf('Of the shops that read the page, how many buy at $29 rather than $49?')).toBe('conversion');
    expect(fourQuestionsOf('Can a hand-screened brief be assembled every week without the owner\'s time?')).toBe('fulfilment');
    expect(fourQuestionsOf('Would shops that arrive by search convert at the same rate as those written to?')).toBe('conversion');
    expect(fourQuestionsOf('Is there any demand for this at all?')).toBe('demand');
  });

  it('never answers with a question it cannot read: an unreadable sentence is demand, the widest, and says so', () => {
    expect(fourQuestionsOf('')).toBe('demand');
    expect(fourQuestionsOf('the weather')).toBe('demand');
  });
});
