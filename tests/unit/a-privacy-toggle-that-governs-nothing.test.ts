process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { RECORDED_PREFERENCE_ONLY, recordConsent } from '../../src/services/privacy/consent.js';

// =============================================================================
// A CONTROL THE FOUNDER CAN SET MUST GOVERN SOMETHING.
//
// The privacy page offered four toggles. `hasConsent` had exactly one call site
// in all of `src/`, for a fifth type that the page does not offer and the route
// does not accept. So every toggle a founder could actually set was read by
// nothing: ticking it and leaving it alone produced identical behaviour.
//
// The benchmarking one carried a promise as well — "your data is stripped of
// all identifying information before contributing" — while every operating
// company's churn and activation rate went into the pool against its company
// id, consent or not.
//
// And the pool had no floor but `length === 0`, so a segment with one
// contributor published that company's exact churn as all four percentiles, and
// counted contributions rather than companies: one company contributing weekly
// read as fifty-two peers after a year.
//
// The honest half is stated rather than papered over: the pool is not anonymous
// at rest and cannot be, because erasure has to know whose row it is. What is
// true is consent, and an aggregate over enough distinct companies.
//
// THE POOL IS GONE (Private S7, 29 September 2026). One owner has no peers to
// be compared with, so the pool, its toggle and the cases that held them were
// deleted. The rule this file exists for survives the subject that taught it:
// every toggle left must govern something or say why not.
// =============================================================================

async function company(id: string): Promise<void> {
  await query(`INSERT OR IGNORE INTO founders (id,clerk_user_id,email) VALUES (?,?,?)`,
    [`f_${id}`, `clerk_${id}`, `${id}@example.com`]);
  await query(`INSERT OR IGNORE INTO products (id,name,owner_id,status) VALUES (?,?,?,'active')`,
    [id, `Co ${id}`, `f_${id}`]);
}

beforeAll(async () => { await runMigrations(); });

describe('what the founder is promised', () => {
  it('offers no benchmark pool, because there is no one to compare with', () => {
    const page = stripComments(readFileSync(
      resolve(__dirname, '../../src/routes/dashboard/privacy.ts'), 'utf8'), { lineComments: true });
    expect(page).not.toContain('benchmark_contribution');
    expect(page).not.toContain('Contribute to Benchmarking');
  });

  it('no longer claims a scale nobody measured, or a control that is not offered', () => {
    const page = readFileSync(
      resolve(__dirname, '../../src/routes/dashboard/privacy.ts'), 'utf8');
    // Rendered strings only. The comments beside them quote the old copy on
    // purpose, and a scan that read those would be checking the explanation.
    const shown = stripComments(page, { lineComments: true });

    expect(shown, 'a scale nobody counted').not.toContain('hundreds of products');
    expect(shown, 'an eligibility floor is not a statistic')
      .not.toContain('statistical patterns');
    // The funnel used to record a named founder either way. The owner's §14
    // decision split it: service state is disclosed as always-recorded, and the
    // usage half is now genuinely gated. The page may claim neither more nor
    // less than that.
    expect(shown, 'the usage half was never anonymised, and is now hashed rather than absent')
      .not.toContain('anonymized usage patterns');
    expect(shown, 'the always-recorded half is disclosed in plain words')
      .toContain('what it needs to run and bill your account');
    expect(shown, 'and off means not written, not written-and-ignored')
      .toContain('nothing is written');
  });

  it('cannot grant the one consent the code enforces elsewhere, which is why that path is dead', async () => {
    // `decisions/patterns.ts` gates the peer decision signal on
    // `cross_company_patterns`. That type is in the TypeScript union and NOT in
    // migration 041's CHECK, so it can never be recorded and `getPeerSignal`
    // always returns null. Recorded as a fact rather than repaired: the careful
    // path being unreachable is the reason its careless sibling matters.
    await company('bp_check');
    await expect(recordConsent('bp_check', 'f_bp_check', 'cross_company_patterns' as never, true))
      .rejects.toThrow();
  });
});

describe('every toggle in the vocabulary', () => {
  // The union is the vocabulary; read from the source because a type is erased
  // at runtime and this test is about what the type CLAIMS.
  const consentSource = readFileSync(
    resolve(__dirname, '../../src/services/privacy/consent.ts'), 'utf8');
  const declared = [...consentSource
    .slice(consentSource.indexOf('export type ConsentType ='),
      consentSource.indexOf(';', consentSource.indexOf('export type ConsentType =')))
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

  const srcFiles = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? srcFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
  // Comments in this codebase quote the defect they describe, and a scan that
  // read them would find every type "consulted" by its own explanation.
  const code = srcFiles('src')
    .filter((f) => !f.endsWith('services/privacy/consent.ts'))
    .map((f) => stripComments(readFileSync(f, 'utf8'), { lineComments: true }))
    .join('\n');

  it('is a vocabulary the test can actually see', () => {
    expect(declared).toContain('aggregate_insights');
    expect(declared).not.toContain('benchmark_contribution');
    expect(declared.length).toBeGreaterThanOrEqual(4);
  });

  it('is either consulted somewhere, or a recorded preference with a reason', () => {
    const unaccounted = declared.filter((type) => {
      const consulted = new RegExp(`hasConsent\\([^)]*'${type}'`).test(code);
      const reason = (RECORDED_PREFERENCE_ONLY as Record<string, string | undefined>)[type];
      return !consulted && !(reason && reason.length > 20);
    });
    expect(unaccounted,
      'a control the founder can set must govern something, or say why it does not')
      .toEqual([]);
  });

  it('does not let a path claim exemption while also being consulted', () => {
    // Both would mean the register is describing something other than the code.
    for (const type of Object.keys(RECORDED_PREFERENCE_ONLY)) {
      expect(new RegExp(`hasConsent\\([^)]*'${type}'`).test(code),
        `${type} claims to gate nothing, but something gates on it`).toBe(false);
    }
  });
});
