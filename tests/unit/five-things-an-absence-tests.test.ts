process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  HORIZONS, absenceHorizons, absenceReading, type AbsenceProperty, type PropertyReading,
} from '../../src/services/institution/absence-test.js';

// =============================================================================
// THE FIVE THINGS AN ABSENCE IS A TEST OF.
//
// Not "did anything happen while you were away" — the letter answers that.
// The harder question: if he left today and came back in three months, would
// what he found still be TRUE, still be BOUNDED, still ADD UP, still be
// RECOVERABLE, and would the things waiting for him be HIS.
//
// THE ONE PROPERTY THESE TESTS CARE ABOUT MOST is that the answer is allowed
// to change with the length of the absence. A ceiling per day is a rate, not a
// ceiling. A fourteen-day backup window covers a week and does not cover
// ninety days. A proposal that expires on day nine was not deferred to him —
// it was decided by the clock, and he comes back to a screen showing nothing
// waiting because everything waiting already timed out.
//
// An institution that answers "fine" at every horizon has not been asked.
// =============================================================================

let OWNER = '';
let COMPANY = '';

const NOW = new Date('2026-09-14T12:00:00Z');
const day = (offset: number): string =>
  new Date(NOW.getTime() + offset * 86_400_000).toISOString();

function find(props: PropertyReading[], p: AbsenceProperty): PropertyReading {
  const found = props.find((x) => x.property === p);
  if (!found) throw new Error(`no reading for ${p}`);
  return found;
}

async function readingAt(days: number): Promise<PropertyReading[]> {
  return (await absenceReading(OWNER, days, NOW)).properties;
}

beforeAll(async () => { await runMigrations(); });

beforeEach(async () => {
  OWNER = nanoid();
  COMPANY = nanoid();
  await query('INSERT INTO founders (id, clerk_user_id, email, name) VALUES (?,?,?,?)',
    [OWNER, `clerk_${OWNER}`, `${OWNER}@example.test`, 'Owner']);
  await query(
    `INSERT INTO products (id, owner_id, name, status, standing, reality, posture, created_at)
     VALUES (?,?,?,'active','earned','real','grow', datetime('now'))`,
    [COMPANY, OWNER, 'A real company']);
});

describe('truthful — would silence be mistaken for calm', () => {
  it('does not hold while a company has nothing connected to it', async () => {
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('DOES_NOT_HOLD');
    expect(t.evidence.join(' ')).toContain('nothing connected');
    expect(t.wouldFixIt.join(' ')).toContain('quiet from it means nothing');
  });

  it('holds once something reports on every company', async () => {
    await query(
      `INSERT INTO company_senses
         (id, product_id, sense_key, provider, mode, disclosure, connected_at)
       VALUES (?,?,'revenue','stripe','real','what it earns', datetime('now'))`,
      [nanoid(), COMPANY]);
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('HOLDS');
  });

  it('does not hold when a sense is erroring, because the page would look the same', async () => {
    await query(
      `INSERT INTO company_senses
         (id, product_id, sense_key, provider, mode, disclosure, connected_at, last_error)
       VALUES (?,?,'revenue','stripe','real','what it earns', datetime('now'), 'refused')`,
      [nanoid(), COMPANY]);
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('DOES_NOT_HOLD');
  });

  it('notices ANY routine failing repeatedly, not only the two that were named', async () => {
    // WHAT PRODUCTION SHOWED on the day this was written. `behavioral_triggers`
    // had failed forty-nine times in a row since 1 September and nothing the
    // owner could open said so, because the reading was built only on the two
    // loops in INSTITUTION_LOOPS. It fails closed — nothing is sent — which is
    // the right failure and is exactly why nobody noticed.
    await query(
      `INSERT INTO job_health (job_name, last_success_at, last_failure_at, consecutive_failures)
       VALUES ('behavioral_triggers', '2026-09-01 18:00:00', '2026-09-14 12:00:00', 49)`);
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('DOES_NOT_HOLD');
    expect(t.evidence.join(' ')).toContain('behavioral triggers');
    expect(t.evidence.join(' ')).toContain('49 failures in a row');
    expect(t.wouldFixIt.join(' ')).toContain('stop scheduling it');
    await query(`DELETE FROM job_health WHERE job_name = 'behavioral_triggers'`);
  });

  it('does not call one or two failures a broken routine', async () => {
    await query(
      `INSERT INTO company_senses
         (id, product_id, sense_key, provider, mode, disclosure, connected_at)
       VALUES (?,?,'revenue','stripe','real','what it earns', datetime('now'))`,
      [nanoid(), COMPANY]);
    await query(
      `INSERT INTO job_health (job_name, last_success_at, last_failure_at, consecutive_failures)
       VALUES ('some_sweep', '2026-09-13 18:00:00', '2026-09-14 12:00:00', 2)`);
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('HOLDS');
    await query(`DELETE FROM job_health WHERE job_name = 'some_sweep'`);
  });

  it('says the one guarantee that does not decay with time away', async () => {
    // Migration 313 refuses an estimate with no policy and a measurement that
    // carries one. That is structural: it holds at ninety days exactly as it
    // holds at seven, which almost nothing else here does.
    const t = find(await readingAt(90), 'truthful');
    expect(t.evidence.join(' ')).toContain('refuses an estimate with no written policy');
  });
});

describe('bounded — does anything outlast the absence', () => {
  it('multiplies a daily ceiling out to the horizon, because a rate is not a ceiling', async () => {
    const seven = find(await readingAt(7), 'bounded');
    const ninety = find(await readingAt(90), 'bounded');
    expect(seven.sentence).not.toBe(ninety.sentence);
    expect(seven.evidence.join(' ')).toContain('over 7 days');
    expect(ninety.evidence.join(' ')).toContain('over 90 days');
  });

  it('holds when every permission ends by itself', async () => {
    await query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, until)
       VALUES (?,?,?,?,?,?)`,
      [nanoid(), COMPANY, 'testing this idea', 'Up to $50 on the test', 5000, day(10)]);
    const b = find(await readingAt(7), 'bounded');
    expect(b.finding).toBe('HOLDS');
    expect(b.sentence).toContain('ends by itself');
  });

  it('does not hold when an allowance has no end date, whatever its size', async () => {
    await query(
      `INSERT INTO owner_allowances
         (id, product_id, purpose, statement, amount_cents, until, unbounded_because)
       VALUES (?,?,?,?,?,NULL,?)`,
      [nanoid(), COMPANY, 'testing', 'A dollar, forever', 100, 'he said to leave it open']);
    const b = find(await readingAt(7), 'bounded');
    expect(b.finding).toBe('DOES_NOT_HOLD');
    expect(b.evidence.join(' ')).toContain('no end date');
    expect(b.wouldFixIt.join(' ')).toContain('end date');
  });

  it('says which live permissions would still be live when he got back', async () => {
    await query(
      `INSERT INTO owner_allowances (id, product_id, purpose, statement, amount_cents, until)
       VALUES (?,?,?,?,?,?)`,
      [nanoid(), COMPANY, 'testing', 'Up to $50', 5000, day(30)]);
    expect(find(await readingAt(7), 'bounded').evidence.join(' '))
      .toContain('still live when you return');
    expect(find(await readingAt(90), 'bounded').evidence.join(' '))
      .toContain('expires before you return');
  });

  it('treats standing permission with no expiry as a different kind of thing', async () => {
    await query(
      `INSERT INTO autonomy_consents
         (id, founder_id, product_id, capability, from_mode, to_mode, disclosure_version)
       VALUES (?,?,?,'send_email','assist','act','v1')`, [nanoid(), OWNER, COMPANY]);
    const b = find(await readingAt(7), 'bounded');
    expect(b.finding).toBe('DOES_NOT_HOLD');
    expect(b.evidence.join(' ')).toContain('with no end date');
  });
});

describe('understandable — could he follow the money on the way back in', () => {
  it('carries the quality of every step rather than one number', async () => {
    const u = find(await readingAt(30), 'understandable');
    expect(u.evidence.some((e) => e.startsWith('held:'))).toBe(true);
    expect(u.evidence.some((e) => e.startsWith('yours:'))).toBe(true);
  });

  it('never claims more than the worst link in the chain', async () => {
    const u = find(await readingAt(30), 'understandable');
    expect(['HOLDS', 'DOES_NOT_HOLD', 'CANNOT_ESTABLISH']).toContain(u.finding);
    if (u.finding !== 'HOLDS') expect(u.wouldFixIt.length).toBeGreaterThan(0);
  });
});

describe('recoverable — a way back on day N, not on day one', () => {
  it('does not hold when there is no copy at all, and says so plainly', async () => {
    // An in-memory database has nothing to copy, which is what the test
    // harness runs on — so this is the real answer here, not a contrivance.
    const r = find(await readingAt(7), 'recoverable');
    expect(r.finding).toBe('DOES_NOT_HOLD');
    expect(r.sentence).toContain('nothing to put back');
  });

  it('asks the same question at every horizon, in the horizon’s own words', async () => {
    for (const days of HORIZONS) {
      const r = find(await readingAt(days), 'recoverable');
      expect(r.question).toContain(`day ${String(days)}`);
    }
  });
});

describe('only real decisions — will what is waiting still be waiting', () => {
  it('says nothing is waiting when nothing is', async () => {
    const d = find(await readingAt(7), 'only_real_decisions');
    expect(d.finding).toBe('HOLDS');
    expect(d.sentence).toContain('Nothing is waiting');
  });

  it('holds for a proposal that outlives the absence', async () => {
    await proposal(day(20));
    const d = find(await readingAt(7), 'only_real_decisions');
    expect(d.finding).toBe('HOLDS');
    expect(d.evidence.join(' ')).toContain('still there when you return');
  });

  it('does not hold for the same proposal over a longer absence', async () => {
    // THE POINT OF THE WHOLE FILE. One row, two horizons, two answers — and
    // the longer one is the truthful one: a proposal that lapses on day twenty
    // of a ninety-day absence was decided by the calendar.
    await proposal(day(20));
    const d = find(await readingAt(90), 'only_real_decisions');
    expect(d.finding).toBe('DOES_NOT_HOLD');
    expect(d.sentence).toContain('settled by the calendar');
    expect(d.wouldFixIt.join(' ')).toContain('the lapse is the decision');
  });

  it('counts a dated commitment falling inside the absence as going to be late', async () => {
    await query(
      `INSERT INTO institutional_responsibilities
         (id, product_id, title, state, capability, disposition, due_at, due_stated_by)
       VALUES (?,?,?,'assisting','send_email','active',?,?)`,
      [nanoid(), COMPANY, 'file the thing', day(20), OWNER]);
    expect(find(await readingAt(7), 'only_real_decisions').finding).toBe('HOLDS');
    const d = find(await readingAt(30), 'only_real_decisions');
    expect(d.finding).toBe('DOES_NOT_HOLD');
    expect(d.evidence.join(' ')).toContain('falls while you are away');
  });
});

describe('the reading as a whole', () => {
  it('answers all three horizons, in order, with the date he would come back', async () => {
    const all = await absenceHorizons(OWNER, NOW);
    expect(all.map((r) => r.days)).toEqual([7, 30, 90]);
    expect(all[0].returnsOn).toBe('2026-09-21');
    expect(all[2].returnsOn).toBe('2026-12-13');
  });

  it('leads the verdict with what fails, never with what works', async () => {
    const r = await absenceReading(OWNER, 7, NOW);
    // The fixture has a company with nothing connected and no backups, so at
    // least two properties do not hold and the verdict must say so first.
    expect(r.verdict).not.toContain('would leave everything here still true');
  });

  it('gives every property a question, a finding and what it read', async () => {
    const r = await absenceReading(OWNER, 30, NOW);
    expect(r.properties).toHaveLength(5);
    for (const p of r.properties) {
      expect(p.question.length).toBeGreaterThan(10);
      expect(p.sentence.length).toBeGreaterThan(10);
      expect(['HOLDS', 'DOES_NOT_HOLD', 'CANNOT_ESTABLISH']).toContain(p.finding);
      if (p.finding === 'HOLDS') expect(p.wouldFixIt).toHaveLength(0);
    }
  });
});

async function proposal(expiresAt: string): Promise<void> {
  // A PROPOSAL ONLY EXISTS AGAINST A STANDING ASK-FIRST. Without one Foundry
  // would simply act, and migration 228 refuses the row rather than let the
  // institution manufacture decisions for him to make.
  await query(
    `INSERT INTO owner_boundaries (id, product_id, subject, statement, mode)
     VALUES (?,?,'spend_money','Ask me before spending','ask_first')`,
    [nanoid(), COMPANY]);
  await query(
    `INSERT INTO proposed_acts
       (id, product_id, subject, params_fingerprint, summary, why, expected_effect, risk,
        consequence, proposed_by, expires_at)
     VALUES (?,?,'spend_money','abc','buy the thing','because','it arrives','it does not',
             'low','foundry',?)`,
    [nanoid(), COMPANY, expiresAt]);
}
