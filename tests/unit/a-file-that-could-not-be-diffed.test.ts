process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordDevelopmentObservation } from '../../src/services/institution/development-observation.js';
import { CACHE_BREAKPOINT } from '../../src/services/ai/client.js';

// =============================================================================
// A FILE THAT COULD NOT BE DIFFED.
//
// git decides a file is binary if a NUL appears in its first 8000 bytes, and
// then every diff of that file prints "Binary files differ" instead of the
// change — in `git diff`, in `git show`, in `git log -p`, and in a pull request
// review. grep skips it for the same reason. Two source files here carried a
// raw NUL, and one of them was `institution/development-observation.ts`: the
// single writer of development observations, the module whose whole purpose is
// that what a check reported can be audited. Its own changes were unreviewable.
//
// NEITHER WAS CORRUPTION. Both NULs were deliberate and both were the right
// choice of value — a delimiter around a cache sentinel, and a separator
// joining fields before hashing. Only the ENCODING was wrong: a raw byte where
// an escape says exactly the same thing to the compiler. So the fix had to
// change the file and not the behaviour, and this test is what makes that
// claim checkable rather than asserted.
//
// The observation id is content-derived and the insert is INSERT OR IGNORE, so
// the separator is load-bearing in a way that would not announce itself: change
// it and every observation re-records under a new id, inflating the evidence
// the maturity ratchets read. The id below is pinned for that reason.
//
// The last case is the reason a separator exists at all. Without one, the
// fields ['ab','c'] and ['a','bc'] hash identically, and two different
// observations become one. NUL is the separator that no field's content can
// forge.
// =============================================================================

const P = 'p_devobs';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_d','c_d','d@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_d','active')", [P]);
});

beforeEach(async () => { await query('DELETE FROM signal_events'); });

const AT = new Date('2026-08-22T00:00:00.000Z');

describe('the cache sentinel survived being written as an escape', () => {
  it('is still delimited by real NUL characters', () => {
    expect(CACHE_BREAKPOINT.charCodeAt(0)).toBe(0);
    expect(CACHE_BREAKPOINT.charCodeAt(CACHE_BREAKPOINT.length - 1)).toBe(0);
    expect(CACHE_BREAKPOINT.slice(1, -1)).toBe('__FOUNDRY_CACHE_BREAKPOINT__');
    expect(CACHE_BREAKPOINT.length).toBe(30);
  });

  it('cannot be produced by anything a prompt could contain', () => {
    // That is the entire point of a NUL sentinel: JSON, SQL and model output
    // can all carry underscores and capitals, and none of them carry a NUL.
    expect(JSON.stringify({ a: CACHE_BREAKPOINT })).toContain('\\u0000');
  });
});

describe('the development-observation id survived being written as an escape', () => {
  it('still hashes the fields joined by NUL', async () => {
    const obs = await recordDevelopmentObservation({
      productId: P, check: 'typecheck', result: 'passed',
      detail: '0 errors', observedAt: AT,
    });
    // Pinned. If the separator changes, this changes, and every prior
    // observation stops converging on its own identity.
    expect(obs.id).toBe('devobs_e8b6f3d71dc317c34d08ffc2c18da1e8');

    // And the constant says why it is that value: an independent derivation
    // that names the separator out loud, so a reader does not have to trust a
    // hex string. NUL is built at runtime — a raw one in this file would be
    // the very defect the gate exists to refuse.
    const NUL = String.fromCharCode(0);
    const expected = 'devobs_' + createHash('sha256')
      .update(['p_devobs', 'typecheck', 'passed', '0 errors', AT.toISOString()].join(NUL))
      .digest('hex').slice(0, 32);
    expect(obs.id).toBe(expected);
  });

  it('converges rather than accumulating when the same fact is recorded twice', async () => {
    const input = {
      productId: P, check: 'typecheck', result: 'passed',
      detail: '0 errors', observedAt: AT,
    };
    const first = await recordDevelopmentObservation(input);
    const second = await recordDevelopmentObservation(input);

    expect(second.id).toBe(first.id);
    const rows = await query('SELECT COUNT(*) as n FROM signal_events WHERE product_id = ?', [P]);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(1);
  });

  it('keeps two observations apart that a missing separator would merge', async () => {
    // Same characters, different field boundaries. Joined with nothing, these
    // hash to the same id and the second silently disappears into the first.
    const a = await recordDevelopmentObservation({
      productId: P, check: 'lint', result: 'passed', detail: 'x', observedAt: AT,
    });
    const b = await recordDevelopmentObservation({
      productId: P, check: 'lintpassed', result: 'x', detail: '', observedAt: AT,
    });

    expect(b.id).not.toBe(a.id);
    const rows = await query('SELECT COUNT(*) as n FROM signal_events WHERE product_id = ?', [P]);
    expect((rows.rows[0] as unknown as { n: number }).n).toBe(2);
  });
});

describe('no source file is invisible to a diff', () => {
  it('is enforced by a gate, not by remembering', () => {
    // The gate itself is exercised against planted defects in
    // gates-fail-when-they-should. This asserts only that it is wired into the
    // composite that runs, which is what every-gate-runs then enforces.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['lint:columns']).toContain('check-no-raw-control-bytes.mjs');
  });
});
