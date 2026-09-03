process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { raiseUnknown } from '../../src/services/venture/market-evidence.js';
import {
  awaitingHim, proposeWhatRealityWouldSettle, recordResult, whereToLookNext,
} from '../../src/services/venture/validation.js';
import { openMandate, candidatesFor } from '../../src/services/venture/mandate.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';

// =============================================================================
// WHEN READING STOPS HELPING, PROPOSE THE THING THAT WOULD SETTLE IT.
//
// The last step of the research chain, and the one that turns a good sentence
// into an action. The institution could say "the only thing left is what people
// will actually do" and then wait to be asked. Now it proposes the cheapest
// test itself — with a prediction it cannot invent, because what a result looks
// like and what would mean we were wrong are properties of the KIND of question
// and are stated constitutionally.
//
// IT PROPOSES; IT DOES NOT RUN. The sealed prediction waits for him, and the
// experiment machinery still refuses anything he has not approved.
// =============================================================================

const OWNER = 'stop_owner';
let opportunityId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_stop', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'find one',
    shape: null, evidenceMode: 'reference' });
  if ('refused' in opened) throw new Error(opened.refused);
  const found = (await candidatesFor(opened.id)).find((c) => c.headline.includes('dataset'));
  opportunityId = found?.id ?? '';
  // Clear the reference candidate's own questions so this file controls the state.
  await query(
    `UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'set aside'
      WHERE opportunity_id = ? AND answered_at IS NULL`, [opportunityId]);
});

describe('while reading could still help', () => {
  it('proposes nothing', async () => {
    await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
      question: 'whether the registers permit redistribution',
      cheapestTest: 'read their terms' });
    const asked = await proposeWhatRealityWouldSettle({ founderId: OWNER, opportunityId });
    expect(asked.proposed).toHaveLength(0);
    expect((await whereToLookNext(opportunityId)).keepLooking).toBe(true);
  });
});

describe('when only behaviour is left', () => {
  it('proposes the cheapest test, with a prediction it did not invent', async () => {
    await query(
      `UPDATE market_unknowns SET answered_at = datetime('now'), answer = 'they permit it'
        WHERE opportunity_id = ? AND question LIKE '%redistribution%'`, [opportunityId]);
    await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
      question: 'whether anyone would pay for a maintained deadline dataset',
      cheapestTest: 'list one small dataset and watch what the first fifty buyers do' });

    const asked = await proposeWhatRealityWouldSettle({ founderId: OWNER, opportunityId });
    expect(asked.proposed).toHaveLength(1);

    const waiting = await awaitingHim(opportunityId);
    const one = waiting.find((e) => e.question.includes('would pay'));
    expect(one?.whatWeDo).toContain('first fifty buyers');
    // Neither of these is invented: both come from the constitutional shape of
    // a "would pay" question.
    expect(one?.whatWeExpect).toContain('hands over money');
    expect(one?.wouldDisprove).toContain('nobody pays');
    // The institution proposes what to do, never what to spend.
    expect(one?.costCents).toBe(0);
  });

  it('refuses to propose a test for a question nobody named one for', async () => {
    await raiseUnknown({ founderId: OWNER, opportunityId, blocking: true,
      question: 'whether buyers would come back for a second year',
      cheapestTest: null });
    const asked = await proposeWhatRealityWouldSettle({ founderId: OWNER, opportunityId });
    const skipped = asked.skipped.find((s) => s.question.includes('come back'));
    expect(skipped?.because).toContain('a cost with no shape');
  });

  it('does not ask twice for the same thing', async () => {
    const before = (await awaitingHim(opportunityId)).length;
    await proposeWhatRealityWouldSettle({ founderId: OWNER, opportunityId });
    expect((await awaitingHim(opportunityId)).length).toBe(before);
  });

  it('proposes, and runs nothing', async () => {
    const one = (await awaitingHim(opportunityId))[0];
    if (!one) throw new Error('expected a proposal');
    // Still his. The proposal changed nothing about that.
    await expect(recordResult({
      experimentId: one.id, whatHappened: 'four bought', asPredicted: true }))
      .rejects.toThrow(/not_approved/);
  });
});

describe('the job carries it', () => {
  it('walks open candidates and leaves proposals waiting', async () => {
    await query('DELETE FROM venture_experiments', []);
    await JOB_REGISTRY.contested_evidence_tick.fn();
    const waiting = await awaitingHim(opportunityId);
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting.every((e) => e.decision === null)).toBe(true);
    expect(waiting.every((e) => e.ranAt === null)).toBe(true);
  });
});
