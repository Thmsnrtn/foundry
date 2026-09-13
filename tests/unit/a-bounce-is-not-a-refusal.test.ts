process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { readStopConditions, recordDesign, stopConditionsMet } from '../../src/services/venture/probe-design.js';
import { suppress } from '../../src/services/public-workshop/suppression.js';

// =============================================================================
// A BOUNCE IS NOT A REFUSAL.
//
// The Workshop suppresses an address for four different reasons: a person asked
// to be left alone, the provider reported the mailbox dead, a complaint was
// filed, or the owner struck it out. All four are correct suppressions. Only
// the first is anybody saying no.
//
// The opt-out counter used to count all of them, so a dead mailbox arrived as
// both a bounce and a refusal, and an experiment could stop itself against a
// threshold of two while announcing that two people had asked not to be written
// to when nobody had asked. The stop would have been real; the sentence
// explaining it would have been false; and the shops not yet written to would
// have been withheld from on the strength of it.
//
// A DELIVERY FAILURE AND A REFUSAL POINT IN OPPOSITE DIRECTIONS. One says the
// list was wrong and the research should be redone. The other says the offer
// was unwelcome and sending more of it is the wrong move. An experiment that
// adds them together can tell the owner neither.
//
// These hold the two apart under Experiment 001's own envelope — the tighter
// one it was authorised under, not the wider default written for later work.
// =============================================================================

const OWNER = 'bounce_owner';
let X = '';

const countOf = async (kind: string): Promise<{ count: number; threshold: number; met: boolean }> => {
  const r = (await readStopConditions(X)).find((s) => s.kind === kind)!;
  return { count: r.count, threshold: r.threshold, met: r.met };
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_bounce', 'bounce@example.com', 'Owner']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const { designExperiment } = await import('../../src/services/venture/validation.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Shops that build the thing', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(
    `INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('opp_b',?,?,'a brief worth paying for','millwork shops','scattered notices','somebody pays','nobody pays','[]','real')`,
    [m.id, OWNER]);
  await query(
    `INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES ('unk_b',?,'opp_b','will anyone pay',1,'write once')`, [OWNER]);
  X = await designExperiment({
    founderId: OWNER, opportunityId: 'opp_b', unknownId: 'unk_b', evidenceMode: 'real',
    whatWeDo: 'write once', whatWeExpect: 'one pays', wouldDisprove: 'none pays', costCents: 0,
  });
  // EXPERIMENT 001'S OWN ENVELOPE. Tighter than the defaults later written for
  // a larger cohort, and preserved here exactly as the owner authorised it.
  await recordDesign({
    founderId: OWNER, experimentId: X,
    decides: 'whether a shop pays for the brief', decidesBecause: 'nothing cheaper answers it',
    exchange: 'upfront_price', exchangeBecause: 'money is the only answer that costs the sayer something',
    canProve: 'that some shop paid', cannotProve: 'that many would',
    ratherThanWaiting: 'a stranger answers in a week', distribution: 'one message each',
    ifItSucceeds: 'write the second brief', recommendation: 'run', recommendationBecause: 'cheap and decisive',
    designedBy: OWNER,
    stopConditions: [
      { kind: 'bounces', threshold: 3, because: 'Three undeliverable addresses mean the contact research was worse than believed.' },
      { kind: 'opt_outs', threshold: 2, because: 'Two people asking not to be written to is a pattern, and the shops not yet written to did not consent to be the control group for it.' },
    ],
  });
});

describe('a dead mailbox is not a person saying no', () => {
  it('does not count a bounce suppression as an opt-out', async () => {
    // The address is suppressed, correctly — it must not be written to again.
    await suppress({ founderId: OWNER, email: 'dead@example.com', reason: 'bounced', source: 'provider', experimentId: X, note: 'provider:bounced' });
    expect(await countOf('opt_outs')).toMatchObject({ count: 0, met: false });
  });

  it('does not count a complaint or an owner exclusion as an opt-out either', async () => {
    // Both are real facts with their own meanings and, for a complaint, its own
    // stop condition. Neither is a recipient asking to be left alone.
    await suppress({ founderId: OWNER, email: 'angry@example.com', reason: 'complained', source: 'provider', experimentId: X });
    await suppress({ founderId: OWNER, email: 'struck@example.com', reason: 'founder', source: 'owner', experimentId: X });
    expect(await countOf('opt_outs')).toMatchObject({ count: 0, met: false });
  });

  it('a second dead mailbox cannot trip the stop that says two people refused', async () => {
    // THE EXACT FAILURE THIS EXISTS TO PREVENT. Two bounces against a threshold
    // of two used to stop the experiment and report a refusal nobody made.
    await suppress({ founderId: OWNER, email: 'dead2@example.com', reason: 'bounced', source: 'provider', experimentId: X });
    expect(await countOf('opt_outs')).toMatchObject({ count: 0, threshold: 2, met: false });
    const met = await stopConditionsMet(X);
    expect(met.stop, 'two dead mailboxes are not two people refusing').toBe(false);
    expect(met.because).toEqual([]);
  });

  it('still counts a real request not to be contacted', async () => {
    // The fix must not have made the counter blind. One person actually asked.
    await suppress({ founderId: OWNER, email: 'nothanks@example.com', reason: 'they_asked', source: 'page_opt_out', experimentId: X });
    expect(await countOf('opt_outs')).toMatchObject({ count: 1, threshold: 2, met: false });
    expect((await stopConditionsMet(X)).stop).toBe(false);
  });

  it('stops when two people have actually asked, and names what they did', async () => {
    await suppress({ founderId: OWNER, email: 'alsono@example.com', reason: 'they_asked', source: 'reply', experimentId: X });
    const reading = await countOf('opt_outs');
    expect(reading).toMatchObject({ count: 2, threshold: 2, met: true });
    const met = await stopConditionsMet(X);
    expect(met.stop).toBe(true);
    // THE EXPLANATION NAMES THE FACT. Not "2 of 2" — an owner reading that
    // cannot tell a refusal from a dead mailbox, which is the whole question.
    const said = met.because.join(' ');
    expect(said).toContain('2 people asking not to be contacted');
    expect(said).toContain('stops at 2');
    // And what was written down is the same sentence that was reported.
    const row = (await query(
      `SELECT triggered_detail FROM probe_stop_conditions WHERE experiment_id = ? AND kind = 'opt_outs'`, [X]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.triggered_detail)).toBe(met.because[0]);
  });

  it('counted the bounces all along, under their own name and their own threshold', async () => {
    // The suppressions were never the bounce count — delivery failures are read
    // from the actions the provider reported on. Nothing here inflated either.
    const bounces = await countOf('bounces');
    expect(bounces).toMatchObject({ count: 0, threshold: 3, met: false });
    // SUPPRESSION IS WHAT THE INSTITUTION DID, NOT WHAT IT SAW. Six addresses
    // are suppressed and will not be written to again; only two of the six are
    // anybody refusing. The old counter would have read all six as refusals.
    const kinds = Object.fromEntries((await query(
      'SELECT reason, COUNT(*) AS n FROM public_suppressions WHERE experiment_id = ? GROUP BY reason', [X]))
      .rows.map((r) => [String((r as Record<string, unknown>).reason), Number((r as Record<string, unknown>).n)]));
    expect(kinds).toEqual({ bounced: 2, complained: 1, founder: 1, they_asked: 2 });
  });

  it('says what one of a kind is called, so a threshold reads as a sentence', async () => {
    const readings = await readStopConditions(X);
    const optOuts = readings.find((r) => r.kind === 'opt_outs')!;
    expect(optOuts.countedOne).toBe('person asking not to be contacted');
    // The vocabulary no longer describes itself as counting suppressions.
    const kind = (await query(`SELECT counts FROM probe_stop_kinds WHERE kind = 'opt_outs'`))
      .rows[0] as Record<string, unknown>;
    expect(String(kind.counts)).toContain('asked this experiment not to contact them');
    expect(String(kind.counts)).not.toMatch(/^Workshop suppressions/);
  });
});
