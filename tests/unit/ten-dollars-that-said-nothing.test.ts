process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reserveSpend, settledByWork, finishReservation } from '../../src/services/ai/spend-ledger.js';
import { companySpend, institutionSpend, subjectWork } from '../../src/services/ai/client.js';
import { WORK_THE_MODEL_DOES, whatThatWorkIs } from '../../src/services/ai/what-it-is-for.js';

// =============================================================================
// TEN DOLLARS AND FORTY-FIVE CENTS THAT SAID NOTHING ABOUT WHAT IT WAS FOR.
//
// The spend ledger recorded who pays for every model call — product, founder,
// model, cents — and read against production it said $14.88 across 1,099 calls,
// of which $10.45 was Sonnet on 878 calls naming no purpose at all. Fourteen
// per cent of the calls could answer "what was Foundry thinking about"; the
// rest were a number with a model name on it.
//
// The fix is not instrumentation. It is one column, written from a closed
// vocabulary, required at the type boundary — so a new model call does not
// compile until somebody says what it is for.
//
// WHAT THESE HOLD, that a type alone cannot:
//   the vocabulary stays readable, because every name carries its sentence;
//   the reading never silently drops the rows that predate the column;
//   and nothing reintroduces a bare product id as a spend subject.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const P = 'wk_product', F = 'wk_founder';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES (?,'wk_c','wk@test.local')", [F]);
  await query("INSERT INTO products (id, name, owner_id) VALUES (?,'Work Co',?)", [P, F]);
});

beforeEach(async () => { await query('DELETE FROM ai_spend_reservations'); });

const CAPS = { global: 100_000, product: 10_000, founder: 10_000 };

async function settled(work: string | null, cents: number): Promise<void> {
  const r = await reserveSpend({
    productId: P, founderId: F, model: 'anthropic/claude-sonnet-5',
    amountCents: cents, caps: CAPS, work,
  });
  await finishReservation(r, { kind: 'settled', actualCents: cents });
}

describe('the subject says what the money was for', () => {
  it('carries the work on a company call and on an institutional one', () => {
    expect(subjectWork(companySpend(P, 'the daily insight'))).toBe('the daily insight');
    expect(subjectWork(institutionSpend(
      'the owner has no company for this yet, and it is still worth reading',
      'reading an observation'))).toBe('reading an observation');
  });

  it('keeps the object purpose optional, because most calls have no object', () => {
    // THE DISTINCTION THAT STOPS THIS BEING THEATRE. `purpose` links a call to
    // a row — an observation, a candidate — so what a thing cost to reason
    // about can sit beside what it cost to test. Most calls point at no such
    // row, and inventing one would add nothing over `product_id`, which is
    // already recorded, while looking like it had answered something.
    expect(companySpend(P, 'a gate').purpose).toBeUndefined();
    expect(companySpend(P, 'reading an observation', { kind: 'observation', id: 'o1' }).purpose)
      .toEqual({ kind: 'observation', id: 'o1' });
  });

  it('refuses to let a bare product id be a spend subject again', () => {
    // The type is the enforcement and this is the record of why: a bare string
    // said who pays and nothing else, which is how seventy per cent of the
    // spend came to say nothing. Asserted from the source, since a compile
    // error cannot be asserted at runtime.
    const decl = readFileSync(resolve(ROOT, 'src/services/ai/what-it-is-for.ts'), 'utf8');
    expect(decl).toContain('export type SpendSubject = InstitutionSpend | CompanySpend;');
    expect(decl).not.toMatch(/SpendSubject = string \|/);
  });

  it('keeps the declaration out of the module that makes the call', () => {
    // WHY THE HELPERS LIVE HERE AND NOT BESIDE `callSonnet`. Eighteen test
    // files replace `ai/client.js` wholesale with a stub of one function, so a
    // call site that imported its own declaration helper from that module got
    // `undefined` and threw inside the thing under test — which surfaced as
    // "unscored" verdicts in the voice gate, four screens from the cause.
    //
    // Declaring who pays and what for is not making a call. This module has no
    // network, no database and no side effects, so nothing has a reason to
    // mock it.
    const decl = readFileSync(resolve(ROOT, 'src/services/ai/what-it-is-for.ts'), 'utf8');
    expect(decl).not.toMatch(/\bfetch\b|db\/client|reserveSpend/);
    // And the client re-exports them, so one import still reaches both.
    const client = readFileSync(resolve(ROOT, 'src/services/ai/client.ts'), 'utf8');
    expect(client).toMatch(/export \{[\s\S]*institutionSpend[\s\S]*\} from '\.\/what-it-is-for\.js'/);
  });
});

describe('the ledger can be grouped by what the institution was doing', () => {
  it('adds up the calls and the money for each kind of work', async () => {
    await settled('a gate', 3);
    await settled('a gate', 5);
    await settled('the daily insight', 2);
    const rows = await settledByWork(30);
    expect(rows.find((r) => r.work === 'a gate')).toEqual({ work: 'a gate', calls: 2, cents: 8 });
    expect(rows.find((r) => r.work === 'the daily insight')?.calls).toBe(1);
  });

  it('reports what predates the column as unattributed, never as nothing', async () => {
    // THE READING MUST AGREE WITH THE LEDGER. Eleven hundred rows were written
    // before the column existed and cannot be attributed after the fact.
    // Dropping them, or folding them into an "other", makes the total on the
    // page disagree with the total in the table — which is the specific way a
    // summary stops being worth reading.
    await settled(null, 7);
    await settled('a gate', 3);
    const rows = await settledByWork(30);
    expect(rows.find((r) => r.work === null)).toEqual({ work: null, calls: 1, cents: 7 });
    expect(rows.reduce((a, r) => a + r.cents, 0)).toBe(10);
  });

  it('orders by what cost the most, because that is the question', async () => {
    await settled('a gate', 1);
    await settled('red team', 9);
    expect((await settledByWork(30))[0].work).toBe('red team');
  });

  it('does not reach back further than it was asked', async () => {
    await settled('a gate', 4);
    await query("UPDATE ai_spend_reservations SET date = date('now', '-40 day')");
    expect(await settledByWork(30)).toEqual([]);
  });

  it('compares the window against the column built for it, not against an instant', async () => {
    // THE DEFECT THIS LOCKS OUT, found by reading production rather than by a
    // test. All three windowed readings asked `created_at >= datetime('now',?)`.
    // `created_at` is an ISO instant — 2026-09-14T04:00:00.000Z — and
    // `datetime()` returns 2026-08-15 04:00:00 with a space; SQLite compares
    // them as text, and 'T' sorts above ' ' at position eleven. So every row on
    // the boundary day passed regardless of its hour and the window was hours
    // wider at one end than it claimed. It never produced a wild number, which
    // is exactly why it survived: a reading that is quietly a little wrong gets
    // quoted.
    const ledger = readFileSync(resolve(ROOT, 'src/services/ai/spend-ledger.ts'), 'utf8');
    const code = ledger.split('\n').filter((l) => !l.trimStart().startsWith('*')
      && !l.trimStart().startsWith('//')).join('\n');
    expect(code).not.toContain("created_at >= datetime('now'");
    expect(code).toContain("date >= date('now', ?)");
  });

  it('counts a row written at the far edge of the window, and not the one beyond it', async () => {
    await settled('a gate', 1);
    await query("UPDATE ai_spend_reservations SET date = date('now', '-30 day')");
    expect((await settledByWork(30))[0]?.cents).toBe(1);
    await query("UPDATE ai_spend_reservations SET date = date('now', '-31 day')");
    expect(await settledByWork(30)).toEqual([]);
  });
});

describe('the vocabulary stays something a person can read', () => {
  it('gives every kind of work a sentence, not a slug', () => {
    for (const [work, meaning] of Object.entries(WORK_THE_MODEL_DOES)) {
      expect(meaning.length, `${work} has no explanation`).toBeGreaterThan(20);
      // A name that merely restates itself explains nothing.
      expect(meaning.toLowerCase(), `${work} explains itself with itself`).not.toBe(work.toLowerCase());
    }
  });

  it('answers what a name in the ledger means, and says so when it does not know', () => {
    expect(whatThatWorkIs('a gate')).toContain('good enough');
    // A name from before the vocabulary, or one somebody wrote by hand into the
    // database. The reading shows the name and no explanation rather than
    // inventing one.
    expect(whatThatWorkIs('something nobody declared')).toBeNull();
  });

  it('is what the build gate reads, rather than a second copy of it', () => {
    // The gate parses this file for the vocabulary. If it kept its own list the
    // two would drift, and the drift would show up as a name the type system
    // accepts and the build rejects.
    const gate = readFileSync(resolve(ROOT, 'scripts/check-ai-attribution.mjs'), 'utf8');
    expect(gate).toContain('src/services/ai/what-it-is-for.ts');
    expect(gate).toContain('WORK_THE_MODEL_DOES');
  });
});
