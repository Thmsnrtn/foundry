process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { noteExposure, portfolioFitOf } from '../../src/services/founder/resilience.js';

// =============================================================================
// A SHARED AUDIENCE IS NOT A SHARED FAULT.
//
// The institution used to read every kind of sameness as fragility, because the
// only thing it had to read was `exposure_dimensions`, and every one of those
// twenty-one rows is written as harm. That is correct for the table and wrong
// as a portfolio verdict: two businesses resting on one payment provider go
// down in the same minute, and two businesses sold to buyers Foundry has
// already proved it can reach are the cheapest second sale it will ever make.
// Told apart, one is a reason for caution and the other is a reason the
// candidate is affordable.
//
// AND IT WAS WRONG IN A SECOND, QUIETER WAY. The only real-world writer of a
// candidate's exposures is the legal pass. A real candidate therefore arrived
// carrying exactly one row - a legal surface - which the fit reader sets aside
// by design, leaving both of its lists empty and the old rule
// (`its.length > 0 && newGround.length === 0`) answering WORSE. Every real
// candidate that had been read by a lawyer's eye was told it would make the
// portfolio more fragile, on the strength of having been read.
//
// THE THIRD FAULT IS THE ONE THE FILE'S OWN HEADER FORBIDS. The portfolio side
// of the comparison filters by `evidence_mode`; the candidate side did not. A
// filter that is right on one side and missing on the other does not disagree
// loudly. It agrees, silently, about the wrong world.
// =============================================================================

const OWNER = 'sa_owner';
const EARNED = 'sa_co_earned';

// Every exposure here is `owner_said`: these proofs are about how sameness is
// READ, and a guessed row would put a second variable in every sentence.
async function candidate(id: string, rows: Array<[string, string]>,
  mode: 'real' | 'reference' = 'real'): Promise<string> {
  for (const [dimension, value] of rows) {
    await noteExposure({
      founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
      dimension, value, howKnown: 'owner_said', evidenceMode: mode,
    });
  }
  return id;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_sa', 'owner@example.com', 'Owner']);
  // ONE EARNED BUSINESS, not four. The second thing you own is where a
  // concentration starts, and the reader has to be right at two before it is
  // worth trusting at six.
  await query(
    `INSERT INTO products (id, name, owner_id, status, standing, reality)
     VALUES (?,'Fieldnote',?,'active','earned','real')`, [EARNED, OWNER]);
  for (const [dimension, value] of [
    ['acquisition_channel', 'the workshop'],
    ['customer_type', 'small operators'],
    ['provider_dependency', 'stripe'],
    ['revenue_model', 'subscription'],
  ] as Array<[string, string]>) {
    await noteExposure({
      founderId: OWNER, subjectKind: 'company', subjectId: EARNED,
      dimension, value, howKnown: 'owner_said', evidenceMode: 'real',
    });
  }
});

describe('reach already paid for, told apart from a fault already carried', () => {
  it('reports reuse as reuse, and still refuses to call it independence', async () => {
    // The same channel and the same kind of buyer, and nothing else known.
    //
    // A FIRST VERSION OF THIS PROOF ASSERTED THE OPPOSITE, and an adversarial
    // reading was right to break it. Reusing proven reach is a real saving and
    // it is NOT a reason to add the thing: a candidate that differs from the
    // portfolio on no axis at all has added no independence, whatever the axis
    // is called, and the dimensions here carry their own refutation — the
    // table's words for a shared channel are "one channel closing takes the
    // customers of everything on it".
    //
    // So the split lives in what the owner READS, not in the verdict.
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_same_audience', [
        ['acquisition_channel', 'the workshop'],
        ['customer_type', 'small operators'],
      ]),
    });

    expect(fit.deepens).toHaveLength(0);
    expect(fit.reuses.map((r) => r.value).sort())
      .toEqual(['small operators', 'the workshop']);
    expect(fit.makesItWorse).toBe(true);
    // BOTH HALVES OR NEITHER. Cheaper to sell, and no more independent.
    expect(fit.verdict).toContain('ground you already stand on');
    expect(fit.verdict).toContain('makes the selling cheaper');
    expect(fit.verdict).toContain('adds no independence at all');
  });

  it('does not call reuse fragile when the candidate also opens new ground', async () => {
    // The case the distinction is actually for: the buyers are already
    // reachable AND how it earns is new. Nothing here is a reason against it.
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_reach_and_new', [
        ['acquisition_channel', 'the workshop'],
        ['revenue_model', 'one-off purchase'],
      ]),
    });
    expect(fit.makesItWorse).toBe(false);
    expect(fit.reuses.map((r) => r.value)).toEqual(['the workshop']);
    expect(fit.newGround.map((n) => n.value)).toEqual(['one-off purchase']);
    expect(fit.verdict).toContain('reach you have already paid for');
  });

  it('still calls a candidate worse for resting on the same provider', async () => {
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_same_rails', [
        ['provider_dependency', 'stripe'],
        ['revenue_model', 'subscription'],
      ]),
    });

    expect(fit.makesItWorse).toBe(true);
    expect(fit.reuses).toHaveLength(0);
    expect(fit.deepens.map((d) => d.value).sort()).toEqual(['stripe', 'subscription']);
    expect(fit.verdict).toContain('another way the same failure hurts');
  });

  it('says the cheap sale and the shared fault in one sentence when both are true', async () => {
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_both', [
        ['acquisition_channel', 'the workshop'],
        ['provider_dependency', 'stripe'],
      ]),
    });

    expect(fit.makesItWorse).toBe(true);
    expect(fit.deepens.map((d) => d.value)).toEqual(['stripe']);
    expect(fit.reuses.map((r) => r.value)).toEqual(['the workshop']);
    expect(fit.verdict).toContain('another way the same failure hurts');
    expect(fit.verdict).toContain('the workshop');
  });

  it('does not let shared reach hide that the candidate opens nothing new', async () => {
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_reach_only', [
        ['customer_type', 'small operators'],
      ]),
    });
    expect(fit.newGround).toHaveLength(0);
    expect(fit.makesItWorse).toBe(true);
    expect(fit.verdict).toContain('another way the same failure hurts');
  });
});

describe('a liability is not a portfolio verdict', () => {
  it('refuses to call a candidate fragile for carrying one new legal surface', async () => {
    // This is what EVERY real candidate looks like today, because the legal
    // pass is the only real-world writer of these rows.
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_legal_only', [
        ['legal_exposure', 'claims_advertising'],
      ]),
    });

    expect(fit.makesItWorse).toBe(false);
    expect(fit.deepens).toHaveLength(0);
    expect(fit.newGround).toHaveLength(0);
    expect(fit.verdict).toContain('not enough to say');
    // AND IT IS NOT AN ARGUMENT IN ITS FAVOUR EITHER. Silence about the
    // portfolio is silence, not approval.
    expect(fit.verdict).toContain('not a reason against it either');
  });

  it('still counts a legal surface the portfolio already carries', async () => {
    await noteExposure({
      founderId: OWNER, subjectKind: 'company', subjectId: EARNED,
      dimension: 'legal_exposure', value: 'personal_data',
      howKnown: 'owner_said', evidenceMode: 'real',
    });
    const fit = await portfolioFitOf({
      founderId: OWNER,
      opportunityId: await candidate('sa_legal_shared', [
        ['legal_exposure', 'personal_data'],
      ]),
    });
    expect(fit.deepens.map((d) => d.value)).toEqual(['personal_data']);
    expect(fit.makesItWorse).toBe(true);
  });
});

describe('which world the candidate is from', () => {
  it('does not read a rehearsal candidate into a real verdict', async () => {
    // Declared entirely in the rehearsal world, and identical to the real
    // portfolio on the axis that would make it fragile.
    const id = await candidate('sa_rehearsal', [
      ['provider_dependency', 'stripe'],
      ['revenue_model', 'subscription'],
    ], 'reference');

    const asReal = await portfolioFitOf({ founderId: OWNER, opportunityId: id });
    expect(asReal.deepens).toHaveLength(0);
    expect(asReal.reuses).toHaveLength(0);
    expect(asReal.newGround).toHaveLength(0);
    expect(asReal.makesItWorse).toBe(false);
    expect(asReal.verdict).toContain('I do not know enough about how this would make money');
  });

  it('reads the same rehearsal candidate when the rehearsal world is asked by name', async () => {
    const fit = await portfolioFitOf({
      founderId: OWNER, opportunityId: 'sa_rehearsal', world: 'reference',
    });
    // The rehearsal portfolio here is empty, so there is nothing for it to
    // deepen - but its own exposures are visible, which is the difference.
    expect(fit.newGround.map((n) => n.value).sort()).toEqual(['stripe', 'subscription']);
  });

  it('does not read a real candidate into a rehearsal verdict', async () => {
    const fit = await portfolioFitOf({
      founderId: OWNER, opportunityId: 'sa_same_rails', world: 'reference',
    });
    expect(fit.newGround).toHaveLength(0);
    expect(fit.verdict).toContain('I do not know enough');
  });
});

// =============================================================================
// AND WHO WOULD BUY IT, ASKED BEFORE THE CANDIDATE HAS ALREADY WON.
//
// Distribution used to arrive one step too late - free text on the experiment
// design, composed after a candidate had been selected on somebody's pain and a
// legal reading. A candidate could be taken forward with nothing on record
// about how its buyers would be found. Being able to make the thing is not the
// same as being able to sell it, and a portfolio thesis of small digital income
// is mostly the second problem.
// =============================================================================

describe('how its buyers would be reached', () => {
  async function opportunity(id: string): Promise<string> {
    await query(
      `INSERT INTO venture_opportunities
         (id, mandate_id, founder_id, headline, who_has_it, the_problem,
          why_it_might, kill_thesis, sources_json, evidence_mode)
       VALUES (?,?,?,?,?,?,?,?,?,'real')`,
      [id, 'sa_mandate', OWNER, 'A dated shortlist of licence renewals',
        'small operators', 'the register is scattered and goes stale',
        'they already pay somebody to check it', 'nobody pays for public data',
        JSON.stringify(['reference'])]);
    return id;
  }

  it('holds a candidate that says how it earns and not how it sells', async () => {
    await query(
      `INSERT INTO venture_mandates (id, founder_id, statement, evidence_mode)
       VALUES ('sa_mandate', ?, 'Find another small digital income stream', 'real')`,
      [OWNER]);
    const { whatStandsInTheWay } = await import('../../src/services/venture/validation.js');

    const id = await opportunity('sa_earns_no_channel');
    for (const [d, v] of [['revenue_model', 'one-off purchase'],
      ['pricing_model', 'per download']] as Array<[string, string]>) {
      await noteExposure({ founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
        dimension: d, value: v, howKnown: 'owner_said', evidenceMode: 'real' });
    }
    const inTheWay = await whatStandsInTheWay(id);
    expect(inTheWay.some((w) => w.includes('how its buyers would be found'))).toBe(true);
    // AND THE BLOCKER NAMES WHAT WOULD CLEAR IT. A gate that says only "no"
    // is a gate the owner has to reverse-engineer.
    expect(inTheWay.some((w) => w.includes('name the channel'))).toBe(true);
  });

  it('does not hold a candidate that has said nothing at all', async () => {
    // THE DEADLOCK THIS GATE NEARLY WAS. Nothing on the real path writes an
    // `acquisition_channel` exposure — the three callers of `noteExposure` are
    // the two rehearsal seeders and the legal pass, and the legal pass writes
    // one dimension. An unconditional gate would therefore have held EVERY real
    // candidate for ever, behind a sentence that reads like an action item and
    // no control anywhere that performs it. A gate nobody can satisfy is not a
    // standard; it is an outage with a principled explanation.
    const { whatStandsInTheWay } = await import('../../src/services/venture/validation.js');
    const inTheWay = await whatStandsInTheWay(await opportunity('sa_says_nothing'));
    expect(inTheWay.some((w) => w.includes('how its buyers would be found'))).toBe(false);
  });

  it('clears once a channel is on record, at the same standing as how it charges', async () => {
    const id = await opportunity('sa_has_channel');
    for (const [d, v] of [['revenue_model', 'one-off purchase'],
      ['acquisition_channel', 'the workshop']] as Array<[string, string]>) {
      await noteExposure({ founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
        dimension: d, value: v, howKnown: 'owner_said', evidenceMode: 'real' });
    }
    const { whatStandsInTheWay } = await import('../../src/services/venture/validation.js');
    const inTheWay = await whatStandsInTheWay(id);
    expect(inTheWay.some((w) => w.includes('how its buyers would be found'))).toBe(false);
    // The other gates are untouched: this candidate still has nothing checkable
    // claimed about it, and that is still in the way.
    expect(inTheWay.some((w) => w.includes('nothing has been claimed'))).toBe(true);
  });

  it('does not accept a retired channel as an answer', async () => {
    const id = await opportunity('sa_retired_channel');
    for (const [d, v] of [['revenue_model', 'one-off purchase'],
      ['acquisition_channel', 'cold email']] as Array<[string, string]>) {
      await noteExposure({ founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
        dimension: d, value: v, howKnown: 'owner_said', evidenceMode: 'real' });
    }
    await query(
      `UPDATE portfolio_exposures SET retired_at = CURRENT_TIMESTAMP
        WHERE subject_id = ? AND dimension = 'acquisition_channel'`, [id]);
    const { whatStandsInTheWay } = await import('../../src/services/venture/validation.js');
    expect((await whatStandsInTheWay(id))
      .some((w) => w.includes('how its buyers would be found'))).toBe(true);
  });

  it('does not read a rehearsal candidate\'s channel as a real one', async () => {
    // The same filter the portfolio side carries. Without it a rehearsal
    // declaration would satisfy a real candidate's gate.
    const id = await opportunity('sa_reference_channel');
    await noteExposure({ founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
      dimension: 'revenue_model', value: 'one-off purchase',
      howKnown: 'owner_said', evidenceMode: 'real' });
    await noteExposure({ founderId: OWNER, subjectKind: 'opportunity', subjectId: id,
      dimension: 'acquisition_channel', value: 'a rehearsal channel',
      howKnown: 'owner_said', evidenceMode: 'reference' });
    const { whatStandsInTheWay } = await import('../../src/services/venture/validation.js');
    expect((await whatStandsInTheWay(id))
      .some((w) => w.includes('how its buyers would be found'))).toBe(true);
  });
});
