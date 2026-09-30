import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// =============================================================================
// THE RECORD NAMES THE MEASURE (Roadmap 2027 R0, 30 September 2026;
// OBJECTIVE §6, STRATEGY S87, ROADMAP D8).
//
// Nothing counts unless it moves recurring owner-minutes down (A), calibration
// up (C) or cost per decision down (D), or holds a bound (B). An addition that
// moves none of them is machinery, and the honest thing is to say so. So from
// Roadmap 2027 on, every slice closed in ROADMAP.md's Done table says, in the
// row itself, which measure it moves, the event that earned it, and the
// condition under which it is deleted. A row that cannot fill those in was
// machinery before it was built.
// =============================================================================

const DOCS = resolve(import.meta.dirname, '../../docs/foundry-institution');
const roadmap = readFileSync(resolve(DOCS, 'ROADMAP.md'), 'utf8');
const plan = readFileSync(resolve(DOCS, 'ROADMAP_2027.md'), 'utf8');
const index = readFileSync(resolve(DOCS, 'README.md'), 'utf8');

const rows2027 = roadmap.split('\n').filter((l) => /^\| 2027 R\d+ \|/.test(l));

describe('Roadmap 2027 is part of the record', () => {
  it('is indexed, and says it grants nothing', () => {
    expect(index).toContain('[`ROADMAP_2027.md`](ROADMAP_2027.md)');
    expect(plan).toContain('It grants nothing');
  });

  it('keeps its falsifier date and its refusals', () => {
    expect(plan).toContain('29 March 2027');
    expect(plan).toMatch(/## Part V: What this roadmap refuses/);
    expect(plan).toMatch(/## Part VI: What would show this roadmap wrong/);
  });
});

describe('every closed 2027 slice names its measure, its event and its end', () => {
  it('has at least the first slice closed', () => {
    expect(rows2027.length).toBeGreaterThan(0);
  });

  for (const row of rows2027) {
    const id = /^\| (2027 R\d+) \|/.exec(row)![1]!;
    it(`${id} says what it moves, what earned it, and when it goes`, () => {
      expect(row, id).toMatch(/\*\*Measure:\*\* (?:[ABCD](?:, [ABCD])*|none: record only)\b/);
      expect(row, id).toMatch(/\*\*Earned by:\*\* \S/);
      expect(row, id).toMatch(/\*\*Deleted when:\*\* \S/);
    });
  }
});
