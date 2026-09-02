process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  absorbGuidance, candidatesFor, currentMandate, openMandate,
} from '../../src/services/venture/mandate.js';
import {
  advance, awaitingHim, decideExperiment, designExperiment, overWhatHeSaid,
  recordResult, whatStandsInTheWay, whatWasTried,
} from '../../src/services/venture/validation.js';
import {
  formClaim, observe, openUnknowns, raiseUnknown, settleClaim, standingOf,
} from '../../src/services/venture/market-evidence.js';

// =============================================================================
// SAYING WHAT YOU EXPECT, BEFORE YOU LOOK.
//
// A candidate with claims, evidence and open questions still teaches nothing
// until something is actually tried. This is that step, and it is the one place
// in the venture institution where something is deliberately made hard:
//
//   an experiment may not be proposed without a way to be wrong
//   the prediction is sealed the moment he approves it
//   nothing runs that he did not approve
//   a surprise files evidence AGAINST the claim, through the ordinary door
//   advancing is his act, and only when nothing stands in the way
//
// The failure being designed against is a research function that runs tests
// forever and is never surprised — which is what a justification engine looks
// like from the inside.
// =============================================================================

const OWNER = 'val_owner';
let opportunityId = '';
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_val', 'owner@example.com', 'Owner']);
  const opened = await openMandate({
    founderId: OWNER, statement: 'Find another small digital income stream',
    shape: null, evidenceMode: 'reference' });
  if ('refused' in opened) throw new Error(opened.refused);
  mandateId = opened.id;
  const found = (await candidatesFor(mandateId))
    .find((c) => c.headline.includes('veterinary'));
  if (!found) throw new Error('expected the reference candidate');
  opportunityId = found.id;
});

describe('designing one', () => {
  it('will not accept a test that nothing could disprove', async () => {
    const unknown = (await openUnknowns(opportunityId))[0];
    if (!unknown) throw new Error('expected an open question');
    await expect(designExperiment({
      founderId: OWNER, opportunityId, unknownId: unknown.id,
      whatWeDo: 'talk to some people', whatWeExpect: 'it will go well',
      wouldDisprove: '   ', evidenceMode: 'reference' }))
      .rejects.toThrow(/incomplete/);
  });

  it('will not attach one to a question already answered', async () => {
    const spent = await raiseUnknown({
      founderId: OWNER, opportunityId, blocking: false,
      question: 'something already settled', cheapestTest: null });
    await query(
      "UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'yes' WHERE id = ?",
      [spent]);
    await expect(designExperiment({
      founderId: OWNER, opportunityId, unknownId: spent,
      whatWeDo: 'ask again', whatWeExpect: 'the same answer',
      wouldDisprove: 'a different answer', evidenceMode: 'reference' }))
      .rejects.toThrow(/unknown_already_answered/);
  });

  it('shows him what it would cost against what he said he would spend', async () => {
    await absorbGuidance({
      mandateId, statement: 'Spend no more than $20 validating it',
      kind: 'budget', subject: '20' });
    expect(await overWhatHeSaid({ mandateId, costCents: 1_500 })).toBeNull();
    const over = await overWhatHeSaid({ mandateId, costCents: 9_900 });
    // NOT REFUSED — SHOWN. It is his sentence to reconsider, and an institution
    // that silently enforced it would have made a decision he never saw.
    expect(over).toContain('$99.00');
    expect(over).toContain('no more than $20.00');
  });
});

describe('nothing runs that he did not approve', () => {
  let experimentId = '';

  it('waits for him, with the prediction he would be approving', async () => {
    const unknown = (await openUnknowns(opportunityId))
      .find((u) => u.question.includes('pay'));
    if (!unknown) throw new Error('expected the blocking question');
    experimentId = await designExperiment({
      founderId: OWNER, opportunityId, unknownId: unknown.id,
      whatWeDo: 'take a price to twenty practice managers',
      whatWeExpect: 'at least three ask how to buy it',
      wouldDisprove: 'fewer than three ask, or all of them ask for it free',
      costCents: 1_500, evidenceMode: 'reference' });

    const waiting = await awaitingHim(opportunityId);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.wouldDisprove).toContain('fewer than three');
  });

  it('refuses to run before he has decided', async () => {
    await expect(recordResult({
      experimentId, whatHappened: 'four asked', asPredicted: true }))
      .rejects.toThrow(/not_approved/);
  });

  it('seals the prediction the moment he decides', async () => {
    await decideExperiment({ experimentId, decision: 'approved', by: `founder:${OWNER}` });
    // A prediction that could be edited afterwards would make his approval
    // meaningless and the result unfalsifiable in one stroke.
    await expect(query(
      "UPDATE venture_experiments SET what_we_expect = 'anything at all' WHERE id = ?",
      [experimentId])).rejects.toThrow(/prediction_is_sealed/);
  });

  it('records what happened, and answers the question it was designed against', async () => {
    await recordResult({
      experimentId, whatHappened: 'five asked how to buy it, two of them unprompted',
      asPredicted: true });
    const tried = await whatWasTried(opportunityId);
    expect(tried[0]?.verdict).toBe('as_predicted');
    // The unknown closed because something happened, not because somebody
    // decided it had stopped mattering.
    expect((await openUnknowns(opportunityId)).some((u) => u.question.includes('pay')))
      .toBe(false);
  });
});

describe('a surprise', () => {
  it('files evidence against the claim, through the ordinary door', async () => {
    const claimId = await formClaim({
      founderId: OWNER, claim: 'People will switch tools for this',
      opportunityId, evidenceMode: 'reference' });
    await observe({
      founderId: OWNER, claimId, sourceType: 'community',
      source: 'reference-world:forum', saw: 'lots of complaining about the status quo',
      bearing: 'supports', directness: 'inferred', observedAt: new Date(),
      evidenceMode: 'reference' });
    const unknownId = await raiseUnknown({
      founderId: OWNER, opportunityId, blocking: false,
      question: 'whether complaining turns into switching',
      cheapestTest: 'offer it to thirty of them and count who moves' });

    const id = await designExperiment({
      founderId: OWNER, opportunityId, unknownId, claimId,
      whatWeDo: 'offer it to thirty of them',
      whatWeExpect: 'at least six move within a fortnight',
      wouldDisprove: 'fewer than six move',
      costCents: 0, evidenceMode: 'reference' });
    await decideExperiment({ experimentId: id, decision: 'approved', by: `founder:${OWNER}` });
    await recordResult({
      experimentId: id, whatHappened: 'one moved, and they moved back',
      asPredicted: false });

    const how = await standingOf(claimId);
    // THE SAME CODE PATH THAT RECORDS A SUCCESS RECORDS THE THING THAT
    // UNDERMINES IT. That is what makes this capable of changing its mind.
    expect(how?.contradicts).toBe(1);
    expect(how?.howItStands).toContain('the question is open');
  });
});

describe('becoming a company', () => {
  it('will not advance while something contradicts a claim', async () => {
    const inTheWay = await whatStandsInTheWay(opportunityId);
    expect(inTheWay.join(' ')).toContain('nothing has settled it');
    const tried = await advance({ opportunityId, by: `founder:${OWNER}` });
    expect(tried.advanced).toBe(false);
  });

  it('advances only once nothing is left in the way, and says whose act it was', async () => {
    for (const row of (await query(
      'SELECT id FROM market_claims WHERE opportunity_id = ? AND settled_as IS NULL',
      [opportunityId])).rows as unknown as Array<Record<string, unknown>>) {
      await settleClaim({ claimId: String(row.id), as: 'held', by: `founder:${OWNER}` });
    }
    for (const u of await openUnknowns(opportunityId)) {
      if (u.blocking) {
        await query(
          "UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'settled' WHERE id = ?",
          [u.id]);
      }
    }
    const done = await advance({ opportunityId, by: `founder:${OWNER}` });
    expect(done.advanced).toBe(true);
    // FOUNDRY ESTABLISHES THAT NOTHING IS IN THE WAY. IT DOES NOT MAKE THE
    // COMPANY. That is the decision the whole apparatus exists to put in front
    // of him.
    expect(done.because).toContain('yours to do');
    const row = (await query(
      'SELECT verdict, verdict_why FROM venture_opportunities WHERE id = ?',
      [opportunityId])).rows[0] as Record<string, unknown>;
    expect(String(row.verdict)).toBe('advanced');
    expect(String(row.verdict_why)).toContain(OWNER);
  });

  it('says who settled a claim and when, rather than asserting it held', async () => {
    const row = (await query(
      'SELECT id FROM market_claims WHERE opportunity_id = ? LIMIT 1', [opportunityId]))
      .rows[0] as Record<string, unknown>;
    const how = await standingOf(String(row.id));
    // Settlement outranks accumulation, and carries a name — the same standard
    // every other consequential decision here is held to.
    expect(how?.howItStands).toContain('This held');
    expect(how?.settledBy).toContain(OWNER);
    expect(how?.settledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps what was decided, with the reason, where it can be read', async () => {
    // The constitution calls rejection the valuable half. Until this existed
    // the reason was written and never read again.
    const { whatWasDecided } = await import('../../src/services/venture/mandate.js');
    const decided = await whatWasDecided(mandateId);
    // Two decisions on the record: the one the discipline buried and the one
    // he took forward. Both readable, both with the reason.
    const taken = decided.find((d) => d.verdict === 'advanced');
    expect(taken?.why).toContain('nothing was left standing in the way');
    expect(decided.some((d) => d.verdict === 'rejected')).toBe(true);
  });

  it('never settles a claim twice', async () => {
    const row = (await query(
      "SELECT id FROM market_claims WHERE settled_as IS NOT NULL LIMIT 1", []))
      .rows[0] as Record<string, unknown>;
    // A later disappointment must not be editable into an earlier success.
    await expect(settleClaim({
      claimId: String(row.id), as: 'failed', by: `founder:${OWNER}` }))
      .rejects.toThrow(/already_settled/);
  });
});
