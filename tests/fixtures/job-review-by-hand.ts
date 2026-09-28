// =============================================================================
// THE JOB REVIEW, WORKED BY HAND.
//
// Every figure here was computed on paper from the inputs beside it, with the
// working in the comment, and written down as a number. Nothing here calls
// the recipe or reads its formulas: this is the oracle the file is checked
// against — by `the-job-review-file-is-checked-by-hand` (which executes the
// file's own formulas in an evaluator of its own) and by
// `scripts/recalculate-job-review.mts` (which asks LibreOffice to calculate
// the same files, when LibreOffice is there to ask).
// =============================================================================
import { CELLS, type JobInputs } from '../../src/services/venture/products/recipes/job-review.js';

export type Expected = number | 'unknown' | 'undefined';

/** The result cells a case is judged on, by name. */
export interface Outcome {
  revenue?: [Expected, Expected];
  labor?: [Expected, Expected];
  cost?: [Expected, Expected];
  contribution?: [Expected, Expected];
  margin?: [Expected, Expected];
  /** Materials after credits, labor hours, labor cost, subcontractors, other direct. */
  variance?: [Expected, Expected, Expected, Expected, Expected];
  nextPrice?: Expected;
}

export interface HandCase { name: string; job: JobInputs; expect: Outcome }

export const NORMAL: JobInputs = {
  quotedPrice: 10000, approvedChanges: 0,
  estimate: { materials: 3000, laborHours: 60, laborRate: 50, subcontractors: 1000, otherDirect: 200 },
  actual: { materials: 3400, laborHours: 70, laborRate: 50, subcontractors: 1000, otherDirect: 250, supplierCredit: 0 },
};

export const BY_HAND: HandCase[] = [
  { name: 'a normal job: 2,800 planned contribution became 1,850',
    // est labor 60×50 = 3,000; est cost 3,000+3,000+1,000+200 = 7,200; contribution 10,000−7,200 = 2,800 (28%)
    // act labor 70×50 = 3,500; act cost 3,400−0+3,500+1,000+250 = 8,150; contribution 1,850 (18.5%)
    // next price 8,150+2,800 = 10,950
    job: NORMAL,
    expect: { revenue: [10000, 10000], labor: [3000, 3500], cost: [7200, 8150], contribution: [2800, 1850],
      margin: [0.28, 0.185], variance: [400, 10, 500, 0, 50], nextPrice: 10950 } },

  { name: 'a loss stays visible as a negative contribution and a negative margin',
    // est: labor 30×40 = 1,200; cost 1,500+1,200+0+100 = 2,800; contribution 2,200 (44%)
    // act: labor 55×40 = 2,200; cost 2,600+2,200+800+150 = 5,750; contribution 5,000−5,750 = −750 (−15%)
    // next price 5,750+2,200 = 7,950
    job: { quotedPrice: 5000, approvedChanges: 0,
      estimate: { materials: 1500, laborHours: 30, laborRate: 40, subcontractors: 0, otherDirect: 100 },
      actual: { materials: 2600, laborHours: 55, laborRate: 40, subcontractors: 800, otherDirect: 150, supplierCredit: 0 } },
    expect: { cost: [2800, 5750], contribution: [2200, -750], margin: [0.44, -0.15], nextPrice: 7950 } },

  { name: 'an approved change is judged apart from the quote',
    // est: revenue 8,000; labor 40×45 = 1,800; cost 2,000+1,800+500+0 = 4,300; contribution 3,700 (0.4625)
    // act: revenue 8,000+1,500 = 9,500; labor 52×45 = 2,340; cost 2,600+2,340+500+0 = 5,440; contribution 4,060
    //      margin 4,060 ÷ 9,500 = 0.427368… → 0.4274; next price 5,440+3,700 = 9,140
    job: { quotedPrice: 8000, approvedChanges: 1500,
      estimate: { materials: 2000, laborHours: 40, laborRate: 45, subcontractors: 500, otherDirect: 0 },
      actual: { materials: 2600, laborHours: 52, laborRate: 45, subcontractors: 500, otherDirect: 0, supplierCredit: 0 } },
    expect: { revenue: [8000, 9500], contribution: [3700, 4060], margin: [0.4625, 0.4274], nextPrice: 9140 } },

  { name: 'missing actual hours make everything that needs them unknown, and nothing else',
    job: { ...NORMAL, actual: { ...NORMAL.actual, laborHours: null } },
    expect: { labor: [3000, 'unknown'], cost: [7200, 'unknown'], contribution: [2800, 'unknown'],
      margin: [0.28, 'unknown'], variance: [400, 'unknown', 'unknown', 0, 50], nextPrice: 'unknown' } },

  { name: 'a supplier credit reduces materials, and the margin with it',
    // act cost 3,400−250+3,500+1,000+250 = 7,900; contribution 2,100 (21%); materials variance 3,400−250−3,000 = 150
    // next price 7,900+2,800 = 10,700
    job: { ...NORMAL, actual: { ...NORMAL.actual, supplierCredit: 250 } },
    expect: { cost: [7200, 7900], contribution: [2800, 2100], margin: [0.28, 0.21],
      variance: [150, 10, 500, 0, 50], nextPrice: 10700 } },

  { name: 'zero revenue has no margin, and says "undefined" rather than dividing',
    job: { ...NORMAL, quotedPrice: 0, approvedChanges: 0 },
    expect: { revenue: [0, 0], contribution: [-7200, -8150], margin: ['undefined', 'undefined'] } },

  { name: 'rounds as a spreadsheet does: 12.5 hours at $47.33 is $591.63',
    // 12.5 × 47.33 = 591.625 on paper; in binary it is a hair either side, and a spreadsheet
    // rounds at 15 significant digits first, so ROUND(…, 2) is 591.63, halves away from zero.
    job: { ...NORMAL, actual: { ...NORMAL.actual, laborHours: 12.5, laborRate: 47.33 } },
    expect: { labor: [3000, 591.63] } },

  { name: 'a blank that means "none" must be entered as 0: a blank credit is unknown, not zero',
    job: { ...NORMAL, actual: { ...NORMAL.actual, supplierCredit: null } },
    expect: { cost: [7200, 'unknown'], variance: ['unknown', 10, 500, 0, 50] } },

  { name: 'the invented example the buyer sees on opening',
    // est labor 64×55 = 3,520; est cost 3,800+3,520+1,200+300 = 8,820; contribution 12,400−8,820 = 3,580
    // act labor 79×55 = 4,345; act cost 4,150−120+4,345+1,200+410 = 9,985; revenue 13,300; contribution 3,315
    // margins 3,580 ÷ 12,400 = 0.28871 → 0.2887; 3,315 ÷ 13,300 = 0.24925 → 0.2492 (0.249248…)
    // next price 9,985+3,580 = 13,565
    job: { quotedPrice: 12400, approvedChanges: 900,
      estimate: { materials: 3800, laborHours: 64, laborRate: 55, subcontractors: 1200, otherDirect: 300 },
      actual: { materials: 4150, laborHours: 79, laborRate: 55, subcontractors: 1200, otherDirect: 410, supplierCredit: 120 } },
    expect: { revenue: [12400, 13300], cost: [8820, 9985], contribution: [3580, 3315], margin: [0.2887, 0.2492],
      variance: [230, 15, 825, 0, 110], nextPrice: 13565 } },
];

/** Each expectation as [cell, value], by the file's own map of where things are: an address, not an answer. */
export function expectedCells(o: Outcome): Array<[string, Expected]> {
  const O = CELLS.out;
  const out: Array<[string, Expected]> = [];
  const pair = (refs: { estimate: string; actual: string }, v?: [Expected, Expected]): void => {
    if (v) out.push([refs.estimate, v[0]], [refs.actual, v[1]]);
  };
  pair(O.revenue, o.revenue); pair(O.laborCost, o.labor); pair(O.directCost, o.cost);
  pair(O.contribution, o.contribution); pair(O.margin, o.margin);
  if (o.variance) {
    const V = O.variance;
    [V.materials, V.laborHours, V.laborCost, V.subcontractors, V.otherDirect].forEach((ref, i) => out.push([ref, o.variance![i]]));
  }
  if (o.nextPrice !== undefined) out.push([O.priceForPlannedContribution, o.nextPrice]);
  return out;
}
