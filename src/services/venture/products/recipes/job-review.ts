// =============================================================================
// FOUNDRY — the A03 job review: estimate versus actual, one job.
//
// The owner's handoff of 28 September names this as the leading adjacent
// hypothesis after the Bid Decision Workbook, and says what the owner should
// see before deciding whether to test it: "a completed file, real task
// results, a precise listing, and a support envelope". This is the completed
// file, built so the decision can be made. It is NOT listed, and it does not
// make `template_file` a kind Foundry can sell (`registry.ts`). Whether anybody
// wants it is exactly what has not been shown.
//
// The rules the file keeps, each held by
// `the-job-review-file-is-checked-by-hand`:
//   · BLANK IS UNKNOWN, NEVER ZERO. A blank input makes every result that
//     depends on it read "unknown"; the guide says to enter 0 for none.
//   · A MARGIN ON NO REVENUE IS UNDEFINED, and says so. A loss stays visible.
//   · APPROVED CHANGES ARE KEPT APART from the price originally quoted: the
//     estimate is judged against the quote, the actual against the quote plus
//     the changes.
//   · ONE CURRENCY AND ONE UNIT OF TIME. Inputs in anything else are refused
//     before a file is built, not converted.
//   · THE SAME INPUTS GIVE THE SAME BYTES, so a digest binds the file.
// =============================================================================

import { createHash } from 'node:crypto';
import { buildXlsx, type Cell, type Sheet } from './xlsx.js';

export const JOB_REVIEW_VERSION = '0.1.0';
export const JOB_REVIEW_FILE = `job-review-v${JOB_REVIEW_VERSION}.xlsx`;

/** What one job is, as the buyer would enter it. Undefined or null is blank: not known. */
export interface JobInputs {
  quotedPrice?: number | null;
  approvedChanges?: number | null;
  estimate: { materials?: number | null; laborHours?: number | null; laborRate?: number | null; subcontractors?: number | null; otherDirect?: number | null };
  actual: { materials?: number | null; laborHours?: number | null; laborRate?: number | null; subcontractors?: number | null; otherDirect?: number | null; supplierCredit?: number | null };
  /** The file is in US dollars and hours; anything else is refused. */
  currency?: string;
  hoursUnit?: string;
}

/** Where everything is, so a check can address the file by name rather than by guess. */
export const CELLS = {
  quotedPrice: 'B5', approvedChanges: 'C6',
  estimate: { materials: 'B8', laborHours: 'B9', laborRate: 'B10', subcontractors: 'B11', otherDirect: 'B12' },
  actual: { materials: 'C8', laborHours: 'C9', laborRate: 'C10', subcontractors: 'C11', otherDirect: 'C12', supplierCredit: 'C13' },
  out: {
    revenue: { estimate: 'B16', actual: 'C16' },
    laborCost: { estimate: 'B17', actual: 'C17' },
    directCost: { estimate: 'B18', actual: 'C18' },
    contribution: { estimate: 'B19', actual: 'C19' },
    margin: { estimate: 'B20', actual: 'C20' },
    variance: { materials: 'B23', laborHours: 'B24', laborCost: 'B25', subcontractors: 'B26', otherDirect: 'B27' },
    priceForPlannedContribution: 'B30',
  },
} as const;

const MAX = 1e9;

/** Why these inputs cannot become a file, or null when they can. */
export function refuseJob(i: JobInputs): string | null {
  if ((i.currency ?? 'usd').toLowerCase() !== 'usd') return 'this file is in US dollars; convert nothing silently — enter dollars';
  if ((i.hoursUnit ?? 'h') !== 'h') return 'labor is in hours; enter hours, not minutes or days';
  const values: Array<[string, number | null | undefined]> = [
    ['quoted price', i.quotedPrice], ['approved changes', i.approvedChanges],
    ...Object.entries(i.estimate).map(([k, v]): [string, number | null | undefined] => [`estimated ${k}`, v]),
    ...Object.entries(i.actual).map(([k, v]): [string, number | null | undefined] => [`actual ${k}`, v]),
  ];
  for (const [what, v] of values) {
    if (v === null || v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return `${what} must be a number`;
    if (v < 0) return `${what} cannot be negative; a credit has its own line`;
    if (v > MAX) return `${what} is larger than this file is checked for`;
  }
  return null;
}

const text = (ref: string, t: string, style: Cell['style'] = 'plain'): Cell => ({ ref, value: { kind: 'text', text: t }, style });
const f = (ref: string, formula: string, style: Cell['style'] = 'money'): Cell => ({ ref, value: { kind: 'formula', formula }, style });
const input = (ref: string, v: number | null | undefined, style: 'money_input' | 'input' = 'money_input'): Cell =>
  ({ ref, value: v === null || v === undefined ? { kind: 'blank' } : { kind: 'number', value: v }, style });

/** "unknown" unless every named cell holds a number. */
const known = (refs: string[], then: string): string => `IF(AND(${refs.map((r) => `ISNUMBER(${r})`).join(',')}),${then},"unknown")`;

function jobSheet(j: JobInputs): Sheet {
  const E = CELLS.estimate, A = CELLS.actual, O = CELLS.out;
  return {
    name: 'Job', protect: true, columnWidths: [52, 16, 16],
    nonNegative: ['B5', 'C6', 'B8:C12', 'C13'],
    cells: [
      text('A1', 'Job review — estimate versus actual', 'heading'),
      text('A2', 'Yellow cells are yours. Blank means not known: enter 0 for none.'),
      text('B4', 'Estimate', 'heading'), text('C4', 'Actual', 'heading'),
      text('A5', 'Price quoted (before any changes)'), input(CELLS.quotedPrice, j.quotedPrice),
      text('A6', 'Approved changes (added to the price)'), input(CELLS.approvedChanges, j.approvedChanges),
      text('A8', 'Materials'), input(E.materials, j.estimate.materials), input(A.materials, j.actual.materials),
      text('A9', 'Labor hours'), input(E.laborHours, j.estimate.laborHours, 'input'), input(A.laborHours, j.actual.laborHours, 'input'),
      text('A10', 'Labor rate per hour'), input(E.laborRate, j.estimate.laborRate), input(A.laborRate, j.actual.laborRate),
      text('A11', 'Subcontractors'), input(E.subcontractors, j.estimate.subcontractors), input(A.subcontractors, j.actual.subcontractors),
      text('A12', 'Other direct costs'), input(E.otherDirect, j.estimate.otherDirect), input(A.otherDirect, j.actual.otherDirect),
      text('A13', 'Supplier credits (reduce materials)'), input(A.supplierCredit, j.actual.supplierCredit),

      text('A15', 'What happened', 'heading'),
      text('A16', 'Revenue'),
      f(O.revenue.estimate, known([CELLS.quotedPrice], `ROUND(${CELLS.quotedPrice},2)`)),
      f(O.revenue.actual, known([CELLS.quotedPrice, CELLS.approvedChanges], `ROUND(${CELLS.quotedPrice}+${CELLS.approvedChanges},2)`)),
      text('A17', 'Labor cost'),
      f(O.laborCost.estimate, known([E.laborHours, E.laborRate], `ROUND(${E.laborHours}*${E.laborRate},2)`)),
      f(O.laborCost.actual, known([A.laborHours, A.laborRate], `ROUND(${A.laborHours}*${A.laborRate},2)`)),
      text('A18', 'Direct cost'),
      f(O.directCost.estimate, known([E.materials, O.laborCost.estimate, E.subcontractors, E.otherDirect],
        `ROUND(${E.materials}+${O.laborCost.estimate}+${E.subcontractors}+${E.otherDirect},2)`)),
      f(O.directCost.actual, known([A.materials, A.supplierCredit, O.laborCost.actual, A.subcontractors, A.otherDirect],
        `ROUND(${A.materials}-${A.supplierCredit}+${O.laborCost.actual}+${A.subcontractors}+${A.otherDirect},2)`)),
      text('A19', 'Contribution (revenue less direct cost)'),
      f(O.contribution.estimate, known([O.revenue.estimate, O.directCost.estimate], `ROUND(${O.revenue.estimate}-${O.directCost.estimate},2)`)),
      f(O.contribution.actual, known([O.revenue.actual, O.directCost.actual], `ROUND(${O.revenue.actual}-${O.directCost.actual},2)`)),
      text('A20', 'Margin (contribution ÷ revenue)'),
      f(O.margin.estimate, known([O.contribution.estimate, O.revenue.estimate],
        `IF(${O.revenue.estimate}=0,"undefined",ROUND(${O.contribution.estimate}/${O.revenue.estimate},4))`), 'percent'),
      f(O.margin.actual, known([O.contribution.actual, O.revenue.actual],
        `IF(${O.revenue.actual}=0,"undefined",ROUND(${O.contribution.actual}/${O.revenue.actual},4))`), 'percent'),

      text('A22', 'Where it moved (actual less estimate)', 'heading'),
      text('A23', 'Materials, after credits'),
      f(O.variance.materials, known([A.materials, A.supplierCredit, E.materials], `ROUND(${A.materials}-${A.supplierCredit}-${E.materials},2)`)),
      text('A24', 'Labor hours'),
      f(O.variance.laborHours, known([A.laborHours, E.laborHours], `ROUND(${A.laborHours}-${E.laborHours},2)`), 'plain'),
      text('A25', 'Labor cost'),
      f(O.variance.laborCost, known([O.laborCost.actual, O.laborCost.estimate], `ROUND(${O.laborCost.actual}-${O.laborCost.estimate},2)`)),
      text('A26', 'Subcontractors'),
      f(O.variance.subcontractors, known([A.subcontractors, E.subcontractors], `ROUND(${A.subcontractors}-${E.subcontractors},2)`)),
      text('A27', 'Other direct costs'),
      f(O.variance.otherDirect, known([A.otherDirect, E.otherDirect], `ROUND(${A.otherDirect}-${E.otherDirect},2)`)),

      text('A29', 'For the next quote', 'heading'),
      text('A30', 'Price that would have kept the planned contribution on these actual costs'),
      f(O.priceForPlannedContribution, known([O.directCost.actual, O.contribution.estimate],
        `ROUND(${O.directCost.actual}+${O.contribution.estimate},2)`)),
      text('A31', 'Arithmetic on your own numbers — not a market price, and not a prediction of the next job.'),
    ],
  };
}

const GUIDE = [
  'Job review — how to use it',
  '',
  'What it is for: after a job is finished, see where it made or lost money against what you quoted,',
  'and what the price would have needed to be to keep the contribution you planned.',
  '',
  '1. On the Job sheet, overwrite the example with one finished job. Only the yellow cells take input.',
  '2. Enter the price you quoted before any changes, and approved changes separately.',
  '3. Enter your estimate and what actually happened, line by line. Hours are hours; money is dollars.',
  '4. Leave a cell blank only if you do not know it. Anything that depends on it will say "unknown".',
  '   If there was nothing (no subcontractors, no credit), enter 0.',
  '5. Read "What happened", then "Where it moved", then the price line under "For the next quote".',
  '',
  'What it is not: bookkeeping, tax advice, a market price, or a prediction. It does arithmetic on your',
  'numbers and shows its working; the formulas are locked so they cannot be overwritten by accident.',
  '',
  `Version ${JOB_REVIEW_VERSION}. A corrected file gets a new version number; this one is never replaced silently.`,
];

function guideSheet(): Sheet {
  return { name: 'Guide', protect: true, columnWidths: [110],
    cells: GUIDE.map((line, i) => text(`A${String(i + 1)}`, line, i === 0 ? 'heading' : 'plain')) };
}

/** An invented job, never a customer's record: what the buyer sees on opening. */
export const EXAMPLE_JOB: JobInputs = {
  quotedPrice: 12400, approvedChanges: 900,
  estimate: { materials: 3800, laborHours: 64, laborRate: 55, subcontractors: 1200, otherDirect: 300 },
  actual: { materials: 4150, laborHours: 79, laborRate: 55, subcontractors: 1200, otherDirect: 410, supplierCredit: 120 },
};

/** Build the file for one job. Refuses what it cannot represent honestly. */
export function buildJobReview(job: JobInputs = EXAMPLE_JOB): { bytes: Buffer; sha256: string; version: string; file: string } | { refused: string } {
  const why = refuseJob(job);
  if (why) return { refused: why };
  const bytes = buildXlsx([jobSheet(job), guideSheet()]);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), version: JOB_REVIEW_VERSION, file: JOB_REVIEW_FILE };
}

/** What the file under decision is, what was checked, and what was not: written beside it. */
export function jobReviewManifest(built: { bytes: Buffer; sha256: string; version: string; file: string }): string {
  return [
    '# Job review — the file under decision',
    '',
    `- File: \`${built.file}\``,
    `- Version: ${built.version}`,
    `- SHA-256: \`${built.sha256}\``,
    `- Bytes: ${String(built.bytes.length)}`,
    '- Built by: `job-review` in `src/cli/index.ts`, from `src/services/venture/products/recipes/job-review.ts`',
    '- Opens with: an invented example job, never a customer\'s record',
    '',
    'Not listed anywhere, not for sale, and not a kind of product Foundry may make on its own',
    '(`template_file` stays unmakeable in `products/registry.ts`). It exists so the owner can try it on',
    'his own finished jobs and decide, with the rivals in `../DOSSIER.md`, whether it is worth a test.',
    '',
    'Checked: every result cell against figures worked by hand (`tests/fixtures/job-review-by-hand.ts`),',
    'executed from the formulas as written in the file; and, where recorded, recalculated by',
    'LibreOffice (`RECALCULATED.md`). Not checked: Excel, Numbers, Google Sheets, or any buyer.',
    '',
  ].join('\n');
}
