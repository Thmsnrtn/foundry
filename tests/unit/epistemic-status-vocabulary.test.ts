import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requiredUnderstandingFacts } from '../../src/services/institution/responsibility-understanding.js';

// =============================================================================
// One vocabulary, two directions, and only one of them is fail-closed.
//
// Reading the claims layer side by side found no live defect — the guard on
// `reconstruction_claims` is strong: evidence is required, the evidence must be
// this tenant's, the evidence KINDS are a closed set, `conflicting` demands two
// sources, and `unknown` may carry no value. Every downstream guard admits
// claims with an ALLOW-list, `epistemic_status IN ('known','inferred')`, which
// is the fail-closed direction: a status nobody has thought about is refused.
//
// The service layer does the opposite. `projectResponsibilityUnderstanding`
// treats a fact as unresolved when its status is in a DENY-list —
// `['unknown','conflicting','stale']` — so a status nobody has thought about
// counts as RESOLVED and can satisfy Understanding.
//
// Today the two are equivalent, because the column's CHECK constraint permits
// exactly those five statuses and no more. That equivalence is the whole
// safety margin, and it is invisible: adding a sixth status in a migration
// would leave the database correctly refusing it while the service quietly
// accepted it as good enough to climb a rung on.
//
// This is not a bug report. It is the margin, made checkable, so the day
// somebody adds `disputed` or `superseded` they are told which of these two
// lists they also have to think about.
// =============================================================================

const ROOT = resolve(__dirname, '../..');

/** Every status the column will accept, read from the migration that defines it. */
function permittedStatuses(): string[] {
  const sql = readFileSync(
    resolve(ROOT, 'src/db/migrations/106_reconstruction_claims.sql'), 'utf8');
  const check = /epistemic_status TEXT NOT NULL CHECK\(epistemic_status IN \(([^)]*)\)\)/.exec(sql);
  expect(check, 'the CHECK constraint on epistemic_status must exist').toBeTruthy();
  return [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

/** The statuses the service refuses to treat as settled. */
function serviceDenyList(): string[] {
  const source = readFileSync(
    resolve(ROOT, 'src/services/institution/responsibility-understanding.ts'), 'utf8');
  const deny = /\[([^\]]*)\]\.includes\(fact\.epistemicStatus\)/.exec(source);
  expect(deny, 'the unresolved-status list must be findable').toBeTruthy();
  return [...deny![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe('the epistemic status vocabulary', () => {
  it('is exactly the five the column permits', () => {
    expect(permittedStatuses()).toEqual(
      ['conflicting', 'inferred', 'known', 'stale', 'unknown']);
  });

  it('is partitioned with nothing left over', () => {
    // The margin, stated. Deny-list plus allow-list must be the whole
    // vocabulary: every status is either settled or not, and none is both or
    // neither. A sixth status breaks this the moment it is added, which is the
    // point.
    const permitted = permittedStatuses();
    const denied = serviceDenyList();
    const settled = permitted.filter((s) => !denied.includes(s));

    expect(settled, 'the settled statuses are the ones every database guard admits')
      .toEqual(['inferred', 'known']);
    expect([...denied, ...settled].sort(), 'a status must be on exactly one side')
      .toEqual(permitted);
  });

  it('is admitted by the database with an allow-list, never a deny-list', () => {
    // Structural, across every migration. `IN ('known','inferred')` refuses a
    // status nobody anticipated; `NOT IN ('unknown',…)` admits it. The
    // difference only shows up on the day somebody adds one.
    const dir = resolve(ROOT, 'src/db/migrations');
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(resolve(dir, file), 'utf8').replace(/--[^\n]*/g, '');
      for (const m of sql.matchAll(/epistemic_status\s+NOT\s+IN/gi)) {
        offenders.push(`${file} (offset ${m.index})`);
      }
    }
    expect(offenders,
      'A migration admits claims by excluding known-bad statuses. Use an allow-list, '
      + 'so a status nobody has thought about is refused rather than accepted:\n'
      + offenders.join('\n')).toEqual([]);
  });

  it('still asks for the same facts, so this gate is about status and nothing else', () => {
    // A guard rail on the guard rail: if this test ever starts failing because
    // the fact requirements moved, it is measuring the wrong thing.
    expect(requiredUnderstandingFacts('customer_support').length).toBeGreaterThan(0);
    expect(requiredUnderstandingFacts('operations'))
      .toEqual(expect.arrayContaining(requiredUnderstandingFacts('customer_support')));
  });
});
