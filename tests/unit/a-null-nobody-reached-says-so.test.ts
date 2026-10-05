// =============================================================================
// LAW (Roadmap 2027 R40): A NULL NOBODY REACHED READS "NOT REACHED", WITHOUT
// BEING VOIDED.
//
// A test placed on a page or a payment link that no record shows anybody ever
// opened settled "surprised" and was read everywhere as "this offer, to that
// population, through that channel, in that window, did not sell" — market
// evidence, carried into the forge's lessons and into precedent. Nobody had
// been asked. The sealed rule counted what it said it would and its word
// stands; the result is not voided and nothing about how it binds is decided
// here (that is the owner's decision c). What changes is what it claims: a
// null no record shows reaching anybody establishes nothing about the market.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { outcomeFromRow } from '../../src/services/founder/what-happened.js';

const settled = { decision: 'approved', validity: 'valid', verdict: 'surprised', ran_at: '2026-10-01 06:00:00', what_happened: 'nobody bought', placed: true, purchases: 0, reached: 0 };

describe('what a null nobody reached establishes', () => {
  it('keeps its word, says it was not reached, and claims nothing about the market', () => {
    const o = outcomeFromRow({ ...settled, unreached: true });
    expect(o.word).toBe('surprised');
    expect(o.settled).toBe(true);
    expect(o.meaning).toBe('The prediction did not hold. Not reached: no record shows anyone opened or received it.');
    expect(o.establishes).toMatch(/^nothing about whether anybody wants it/);
    expect(o.establishes).not.toMatch(/did not sell\./);
    expect(o.doesNotEstablish).toMatch(/that it does not sell/);
  });

  it('a null somebody was on record as reaching is read exactly as before', () => {
    const before = outcomeFromRow({ ...settled, reached: 7 });
    const reached = outcomeFromRow({ ...settled, reached: 7, unreached: false });
    expect(reached).toEqual(before);
    expect(reached.establishes).toMatch(/did not sell/);
  });

  it('a sale, a placement that never happened, or a held prediction is never read as unreached', () => {
    expect(outcomeFromRow({ ...settled, purchases: 1, unreached: true }).meaning).not.toMatch(/Not reached/);
    expect(outcomeFromRow({ ...settled, placed: false, unreached: true }).meaning).toMatch(/no offer was ever placed/);
    expect(outcomeFromRow({ ...settled, verdict: 'as_predicted', unreached: true }).meaning).toBe('The prediction held.');
  });
});

describe('every reader that carries a settled result into the next decision reads it', () => {
  it('the outcome itself, precedent, and the forge\'s lessons select whether it was reached', () => {
    for (const f of ['src/services/founder/what-happened.ts', 'src/services/venture/precedent.ts', 'src/services/venture/forge.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/\$\{UNREACHED_SQL\} AS unreached/);
    }
  });
  it('a listing is never called unreached here: its reach is the venue\'s to report', () => {
    const src = readFileSync('src/services/founder/what-happened.ts', 'utf8');
    expect(src).toMatch(/m\.body LIKE '%"listing":%'/);
  });
});
