import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareSchemaToSnapshot } from '../../src/services/foundry/self-observation.js';
import { OBJECTS_MADE_AT_RUNTIME, WRITE_PROBE, madeAtRuntime }
  from '../../src/db/runtime-objects.js';

// =============================================================================
// TWO READINGS OF ONE FACT, DISAGREEING, AND NOTHING COMPARING THEM.
//
// The committed snapshot describes what the migrations build. A running process
// also makes things for itself: `/internal/health` proves the volume accepts
// writes by writing and deleting a row, creating its probe table when missing.
//
// `carrying.ts` — the page the owner reads — excluded that table and correctly
// reported no drift. `foundry/self-observation.ts` — which writes the CANONICAL
// evidence and feeds the one responsibility Foundry actually shadows — did not.
// So for ELEVEN DAYS, every six hours, the institution recorded that a
// responsibility was failing, while the owner's page said it was fine. Forty-
// three failing observations, last passing on 4 September.
//
// Nothing surfaced the disagreement, because the absence reading counted only
// rows in `company_senses` and called Foundry blind — so the one mechanism that
// would have reported the failure was not being read at all. Making
// self-observation count truthfully is what made this visible.
//
// AND THE CORRECTION IT WOULD HAVE PRODUCED WAS WORSE THAN THE FAULT. Left to
// run, the responsibility's own remedy is to regenerate the snapshot — which
// would have written the probe table into the committed description and made
// the description permanently wrong about what the migrations build.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): string => readFileSync(resolve(ROOT, p), 'utf8');

/** A snapshot describing exactly the objects named. */
const snapshotOf = (...names: string[]): string =>
  names.map((n) => `CREATE TABLE ${n} (x TEXT);`).join('\n');

describe('a table a running process made for itself is not drift', () => {
  it('passes when the only undescribed object is the write probe', () => {
    const r = compareSchemaToSnapshot({
      liveObjectNames: ['products', 'founders', WRITE_PROBE],
      snapshotSql: snapshotOf('products', 'founders'),
    });
    expect(r.result).toBe('passed');
  });

  it('still fails for an object a migration really did leave undescribed', () => {
    // The exclusion must not become a way to silence real drift.
    const r = compareSchemaToSnapshot({
      liveObjectNames: ['products', 'founders', WRITE_PROBE, 'a_new_table'],
      snapshotSql: snapshotOf('products', 'founders'),
    });
    expect(r.result).toBe('failed');
    expect(r.detail).toContain('a_new_table');
    expect(r.detail).not.toContain(WRITE_PROBE);
  });

  it('still fails for an object the snapshot describes that does not exist', () => {
    const r = compareSchemaToSnapshot({
      liveObjectNames: ['products'],
      snapshotSql: snapshotOf('products', 'a_table_that_went_away'),
    });
    expect(r.result).toBe('failed');
    expect(r.detail).toContain('a_table_that_went_away');
  });
});

describe('the fact is known once', () => {
  it('is read from the schema layer by both readings, not kept twice', () => {
    // THE DEFECT, EXACTLY: the same fact known in two places is a fact that
    // will be acted on in one.
    for (const f of ['src/services/foundry/self-observation.ts',
      'src/services/institution/carrying.ts']) {
      expect(read(f), `${f} does not use the shared list`).toContain('runtime-objects.js');
      expect(read(f), `${f} keeps its own copy`).not.toMatch(/new Set\(\['health_write_probe'\]\)/);
    }
  });

  it('names the probe table where it is created from the same constant', () => {
    // The route that CREATES it and the comparison that FORGIVES it cannot
    // drift apart if neither spells it.
    const health = read('src/routes/internal/health.ts');
    expect(health).toContain('WRITE_PROBE');
    expect(health).not.toMatch(/CREATE TABLE IF NOT EXISTS health_write_probe/);
  });

  it('is a deliberate short list, not a pattern that forgives anything', () => {
    // A prefix rule would forgive every future table somebody named carelessly.
    expect(OBJECTS_MADE_AT_RUNTIME.size).toBeLessThanOrEqual(3);
    expect(madeAtRuntime(WRITE_PROBE)).toBe(true);
    expect(madeAtRuntime('products')).toBe(false);
    expect(madeAtRuntime('health_write_probe_2')).toBe(false);
  });

  it('says why each entry is there, so it cannot become a silencer', () => {
    const src = read('src/db/runtime-objects.ts');
    expect(src).toContain('/internal/health');
    expect(src).toMatch(/not a way to silence a real drift/i);
  });
});
