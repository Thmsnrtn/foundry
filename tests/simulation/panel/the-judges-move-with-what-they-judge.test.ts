// =============================================================================
// THE JUDGES MOVE WITH WHAT THEY JUDGE (F1, 9 October 2026).
//
// A judge whose verdict does not change when the thing it judges changes is
// decoration. Each scripted judge is held to the property it claims, by
// MUTATING THE PRODUCT, never by reading the judge's code:
//   * every judge: the same file at three times the price is never judged
//     better, and is judged worse by someone;
//   * every judge: a persona with no use for the theme says no;
//   * the careful reader, who "reads the listing against the file itself":
//     a listing that claims pages the file does not have is judged worse, and
//     so is a file whose words were gutted to filler behind the same listing.
// And each judge must move on at least one mutation, so a judge that went
// blind would turn this red rather than ride along.
// =============================================================================
import { describe, expect, it } from 'vitest';
import { JUDGES, heldOutPanel, panelProducts, type Persona, type Product, type Verdict } from './judges.js';
import { THEMES } from '../twin/segments.js';

const rank: Record<Verdict, number> = { yes: 2, maybe: 1, no: 0 };
const capable = panelProducts().filter((x) => x.kind === 'capable');
const personas = heldOutPanel();
const fitting = (x: Product): Persona[] => personas.filter((p) => p.needs.includes(THEMES[x.theme].name));

const MUTATIONS: Record<string, (x: Product) => Product> = {
  'three times the price': (x) => ({ ...x, priceDollars: x.priceDollars * 3 }),
  'a listing that claims ten more pages': (x) => ({ ...x, listedPages: x.pages + 10 }),
  'the words gutted to filler': (x) => ({ ...x, text: Array.from({ length: x.pages }, () => 'Notes.').join('\n') }),
};

describe('each judge moves with the product', () => {
  it('there is something to judge: capable products with personas who need them', () => {
    expect(capable.length).toBeGreaterThanOrEqual(5);
    for (const x of capable) expect(fitting(x).length, x.key).toBeGreaterThan(0);
  });

  for (const j of JUDGES) {
    it(`${j.id}: a dearer copy of the same file is never judged better`, () => {
      for (const x of capable) for (const p of fitting(x)) {
        expect(rank[j.decide(p, MUTATIONS['three times the price']!(x)).verdict], `${j.id} ${x.key} ${p.id}`).toBeLessThanOrEqual(rank[j.decide(p, x).verdict]);
      }
    });
    it(`${j.id}: says no to a persona with no use for the theme`, () => {
      const x = capable[0]!;
      const stranger = personas.find((p) => !p.needs.includes(THEMES[x.theme].name))!;
      expect(j.decide(stranger, x).verdict).toBe('no');
    });
    it(`${j.id}: moves on at least one mutation (it is not blind)`, () => {
      let moved = 0;
      for (const m of Object.values(MUTATIONS)) for (const x of capable) for (const p of fitting(x)) {
        if (j.decide(p, m(x)).verdict !== j.decide(p, x).verdict) moved += 1;
      }
      expect(moved).toBeGreaterThan(0);
    });
  }

  it('the careful reader reads the file: an over-claimed listing and gutted words are each judged worse', () => {
    const reader = JUDGES.find((j) => j.id === 'the-careful-reader')!;
    for (const name of ['a listing that claims ten more pages', 'the words gutted to filler']) {
      let worse = 0; let better = 0;
      for (const x of capable) for (const p of fitting(x)) {
        const d = rank[reader.decide(p, MUTATIONS[name]!(x)).verdict] - rank[reader.decide(p, x).verdict];
        if (d < 0) worse += 1; if (d > 0) better += 1;
      }
      expect(better, name).toBe(0);
      expect(worse, name).toBeGreaterThan(0);
    }
  });
});
