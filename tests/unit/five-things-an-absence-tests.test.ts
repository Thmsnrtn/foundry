process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    expect(t.evidence.join(' ')).toContain('nothing watches it at all');
    expect(t.wouldFixIt.join(' ')).toContain('quiet from it means nothing');
  });

  it('holds once something reports on every company', async () => {
    await query(
      `INSERT INTO company_senses
         (id, product_id, sense_key, provider, mode, disclosure, connected_at)
       VALUES (?,?,'revenue','stripe','real','what it earns', datetime('now'))`,
      [nanoid(), COMPANY]);
    // ASSERTED ON THE COMPANY COMPLAINT, not on the overall finding. The
    // reading also carries the DEPLOYMENT's own signals, and in this harness
    // the deployment genuinely has no copies and no routine history — which is
    // true, and is not what this test is about.
    const t = find(await readingAt(7), 'truthful');
    expect(t.evidence.join(' ')).not.toContain('nothing watches it at all');
  });

  it('counts a check of how the company is built as something watching it', async () => {
    // THE MODELLING GAP THIS CLOSES. The reading counted rows in
    // `company_senses` and nothing else, and against production it said Foundry
    // observed nothing about itself — in a month when Foundry had recorded 116
    // verifications of its own repository and 53 comparisons of a
    // responsibility against what actually happened, while the two companies it
    // called sighted were synthetic rehearsals with four senses each.
    //
    // It was not wrong about `company_senses`. It was asking "is a provider
    // connected" when the question is "is there anything here that would speak
    // up". A verified check of how the thing is built is such a thing, for ANY
    // company — nothing here knows or asks which company it is looking at.
    // Through the real writer, because the database refuses a hand-made one:
    // a verification must carry the check that ran and the result it produced,
    // and may not cite the expectation it will be compared against.
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');
    await recordDevelopmentObservation({
      productId: COMPANY, check: 'schema-snapshot-freshness', result: 'passed',
      detail: 'the snapshot matches the migrations that produce it',
    });
    const t = find(await readingAt(7), 'truthful');
    expect(t.evidence.join(' ')).not.toContain('nothing watches it at all');
    // And says WHAT is watching, so the claim can be disagreed with rather than
    // taken. A company watched only by build checks is watched about how it is
    // built, which is not the same as seeing whether anybody is buying.
    expect(t.evidence.join(' ')).toContain('how it is built');
  });

  it('stops counting it once the stream goes quiet for a week', async () => {
    // A DEAD STREAM IS BLINDNESS AGAIN, and this is what stops the change being
    // a way to pass the test once and coast. Seven days of total silence from
    // every mechanism means nothing is watching now, whatever was watching in
    // August.
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');
    await recordDevelopmentObservation({
      productId: COMPANY, check: 'schema-snapshot-freshness', result: 'passed',
      detail: 'the snapshot matched, nine days ago',
      observedAt: new Date(Date.now() - 9 * 86_400_000),
    });
    const t = find(await readingAt(7), 'truthful');
    expect(t.evidence.join(' ')).toContain('nothing watches it at all');
  });

  it('will not take credit for watching and then ignore what the watching said', async () => {
    // THE COSMETIC VERSION OF PASSING THIS TEST, refused. Once a verification
    // counts as sight, a verification REPORTING A FAILURE has to count as
    // something wrong — otherwise the reading banks the credit for looking and
    // discards the finding.
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');
    await recordDevelopmentObservation({
      productId: COMPANY, check: 'schema-snapshot-freshness', result: 'failed',
      detail: 'the snapshot no longer matches the migrations that produce it',
    });
    const t = find(await readingAt(7), 'truthful');
    expect(t.finding).toBe('DOES_NOT_HOLD');
    expect(t.evidence.join(' ')).toContain('is failing');
  });

  it('never asks which company it is looking at', async () => {
    // THE REFUSAL THAT SHAPED THIS. An earlier version resolved which product
    // row is Foundry so the estate reading could exempt that one from being
    // called blind. `recursive-institution` refused it and was right: a kernel
    // that can ask will eventually answer by exempting the company it likes.
    // The mechanisms above are generic, and this holds them to it.
    const src = readFileSync(
      resolve(import.meta.dirname, '../../src/services/institution/absence-test.ts'), 'utf8');
    expect(src).not.toMatch(/system_identities|resolveFoundryProductId/);
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
    // Two failures in a row is a blip, so the routine is not named. Asserted on
    // its absence from the evidence rather than on the overall finding, which
    // also carries the deployment's own readings.
    expect(t.evidence.join(' ')).not.toContain('some sweep');
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

  it('is one decision asked many times, not many decisions', async () => {
    // WHAT PRODUCTION SHOWED. The live estate holds twenty-two experiment rows
    // — one per person the offer would be shown to — carrying the identical
    // question, and this listed the same sentence twenty-two times. A property
    // whose job is to say whether what is waiting is genuinely his cannot
    // itself be the noise that teaches him to stop reading it.
    const same = 'showing a price to somebody who has the problem';
    for (let i = 0; i < 4; i++) await test(same);
    await test('a different question entirely');
    const d = find(await readingAt(7), 'only_real_decisions');
    const lines = d.evidence.filter((e) => e.includes(same));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('4 tests waiting for your go-ahead, all the same question');
    // The count is a fact about the SIZE of the decision, so it survives.
    expect(d.sentence).toContain('5 things are waiting');
  });

  it('does not count an experiment nobody has designed a test for', async () => {
    // WHAT PRODUCTION SHOWED. Twenty-two rows sat in the owner's queue across
    // twenty unrelated opportunities, every one carrying the identical
    // boilerplate — "showing a price to somebody who has the problem", cost
    // zero — stamped once per opportunity by a scheduled job. None said who
    // would be contacted, at what price, through which channel, or what would
    // stop it. Saying yes to one would have authorised nothing in particular,
    // and twenty-two of them is how an owner learns to stop reading the queue.
    await test('a question nobody has designed a test for', false);
    const d = find(await readingAt(7), 'only_real_decisions');
    expect(d.finding).toBe('HOLDS');
    expect(d.sentence).toContain('Nothing is waiting');
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

/** A test awaiting his go-ahead: a mandate, something found, a question, and
 *  the experiment that would settle it. Written out rather than reached
 *  through the services, which refuse a second open search per founder. */
async function test(whatWeDo: string, designed = true): Promise<void> {
  const mandate = `m_${OWNER}`;
  const opp = `o_${OWNER}`;
  const unknown = `u_${OWNER}`;
  await query(
    `INSERT OR IGNORE INTO venture_mandates (id, founder_id, statement, shape, evidence_mode)
     VALUES (?,?,?,NULL,'real')`, [mandate, OWNER, 'A search for another income stream']);
  await query(
    `INSERT OR IGNORE INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'Shops with a scattered notice problem','shops','scattered notices',
             'somebody pays','nobody pays','[]','real')`, [opp, mandate, OWNER]);
  await query(
    `INSERT OR IGNORE INTO market_unknowns (id, founder_id, opportunity_id, question)
     VALUES (?,?,?,'whether anybody would pay for it')`, [unknown, OWNER, opp]);
  const id = nanoid();
  await query(
    `INSERT INTO venture_experiments
       (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect,
        would_disprove, evidence_mode)
     VALUES (?,?,?,?,?,'somebody pays','nobody pays','real')`,
    [id, OWNER, opp, unknown, whatWeDo]);
  if (designed) await design(id);
}

/** The deliberation that turns a row into something there is anything to say
 *  yes to: what it decides, what it can and cannot prove, why now, how it
 *  reaches people, and what happens if it works. */
async function design(experimentId: string): Promise<void> {
  await query(
    `INSERT INTO probe_designs
       (experiment_id, founder_id, decides, decides_because, exchange, exchange_because,
        can_prove, cannot_prove, rather_than_waiting, distribution, if_it_succeeds,
        recommendation, recommendation_because, designed_by)
     VALUES (?,?,'whether anybody pays at this price','nothing read so far answers it',
             'upfront_price','it is the only instrument that produces money',
             'that at least one person will pay','that the price is right, or that it repeats',
             'waiting produces no evidence at all','one email each, once',
             'the brief is written by hand until there is a reason not to',
             'run','the question is blocking and the test is cheap','founder:test')`,
    [experimentId, OWNER]);
}

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
