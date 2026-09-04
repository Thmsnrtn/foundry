process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { formClaim, observe, openUnknowns } from '../../src/services/venture/market-evidence.js';
import { openSeeds, promote, sow } from '../../src/services/venture/seeds.js';
import { openMandate } from '../../src/services/venture/mandate.js';
import { whereToLookNext } from '../../src/services/venture/validation.js';

// =============================================================================
// WHAT BLOCKS A CANDIDATE IS A ROW, NOT A SENTENCE.
//
// Promotion used to write its open questions into `unknowns_json` — a string,
// for a reader. Everything downstream that acts on a question reads
// `market_unknowns`: what stops a candidate advancing, what an experiment is
// proposed against, what later gets settled.
//
// So a real candidate could be promoted carrying the sentence "whether anybody
// would pay for it, which nothing read so far can answer" and then never move
// again, because no row existed for anything to reach. The one path that DID
// write those rows was the rehearsal fixture — which is precisely why the chain
// appeared to work end to end while being, in reality, a dead end.
//
// The rule is that blocking is DERIVED and never asserted: a question only
// behaviour can settle is blocking by definition, and the constitutional
// `only_settled_by` becomes its cheapest test — the field an experiment cannot
// be proposed without.
// =============================================================================

const OWNER = 'bridge_owner';
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_bridge', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'find one',
    shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  mandateId = opened.id;
});

/** A seed with two genuinely different ways of knowing, which is what promotion takes. */
async function believableSeed(text: string): Promise<string> {
  const claimId = await formClaim({ founderId: OWNER, evidenceMode: 'real',
    claim: `about: ${text}` });
  const observationId = await observe({
    founderId: OWNER, claimId, sourceType: 'community',
    source: 'https://forum.example/1', saw: text, bearing: 'supports',
    directness: 'direct', observedAt: new Date(), evidenceMode: 'real' });
  const sown = await sow({
    founderId: OWNER, mandateId, seed: `maybe worth looking into: ${text}`,
    origin: 'signal', originSaid: text, originObservationId: observationId,
    evidenceMode: 'real' });
  if (typeof sown !== 'string') throw new Error('unexpectedly already buried');
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [sown, claimId]);
  await observe({ founderId: OWNER, claimId, sourceType: 'directory',
    source: 'https://registry.example/x', saw: 'nothing maintained does this',
    bearing: 'supports', directness: 'direct', observedAt: new Date(),
    evidenceMode: 'real' });
  return sown;
}

describe('promotion raises the questions it cannot answer', () => {
  let opportunityId = '';

  it('files each unknown as a row against the candidate', async () => {
    const seedId = await believableSeed('nobody can parse recurrence rules');
    const done = await promote({
      seedId, headline: 'A recurrence rule parser people can rely on',
      whoHasIt: 'developers scheduling anything', theProblem: 'the rules are subtle',
      whyItMight: 'nothing maintained does it and people keep saying so',
      killThesis: 'a platform ships it and the need disappears',
      unknowns: [
        'whether anybody would pay for it, which nothing read so far can answer',
        'how many maintained libraries already cover the same rules',
      ],
      sources: ['https://forum.example/1', 'https://registry.example/x'] });
    expect('opportunityId' in done).toBe(true);
    if (!('opportunityId' in done)) return;
    opportunityId = done.opportunityId;

    const open = await openUnknowns(opportunityId);
    expect(open).toHaveLength(2);
  });

  it('blocks on what only behaviour settles, and says what would settle it', async () => {
    const open = await openUnknowns(opportunityId);
    const money = open.find((u) => u.question.includes('would pay'));
    expect(money?.blocking).toBe(true);
    // The cheapest test is the constitutional one, not a sentence Foundry wrote.
    const constitutional = (await query(
      "SELECT only_settled_by FROM reality_only_questions WHERE pattern = 'would pay'", []))
      .rows[0] as Record<string, unknown>;
    expect(money?.cheapestTest).toBe(String(constitutional.only_settled_by));
  });

  it('leaves a question a source could still answer unblocking', async () => {
    const open = await openUnknowns(opportunityId);
    const readable = open.find((u) => u.question.includes('maintained libraries'));
    expect(readable?.blocking).toBe(false);
    expect(readable?.cheapestTest).toBeNull();
    // And the reading half agrees it is still worth reading — one matcher, so
    // a question cannot be blocking where it is asked and readable where it is
    // answered.
    const next = await whereToLookNext(opportunityId);
    expect(next.stillWorthReading).toContain(readable?.question);
    expect(next.onlyRealityCanSettle.map((r) => r.question))
      .toContain(open.find((u) => u.question.includes('would pay'))?.question);
  });

  it('is now visible to the job that proposes experiments', async () => {
    // The exact selection `contested_evidence_tick` runs. Before this, it
    // matched zero real candidates, forever, and logged itself busy doing it.
    const seen = await query(
      `SELECT DISTINCT o.id FROM venture_opportunities o
        WHERE o.verdict IS NULL
          AND EXISTS (SELECT 1 FROM market_unknowns u
                       WHERE u.opportunity_id = o.id AND u.answered_at IS NULL
                         AND u.blocking = 1)`, []);
    expect((seen.rows as unknown as Array<Record<string, unknown>>)
      .map((r) => String(r.id))).toContain(opportunityId);
  });

  it('refuses to leave a promoted candidate with no way to be reached', async () => {
    // A candidate whose every unknown is readable is legitimate; a candidate
    // with no unknowns at all is the failure this guards — promotion that
    // asserted certainty it never earned.
    const seedId = await believableSeed('deadline data is hard to source');
    const done = await promote({
      seedId, headline: 'A deadline dataset', whoHasIt: 'compliance teams',
      theProblem: 'sourcing is manual', whyItMight: 'two ways of knowing said so',
      killThesis: 'a regulator publishes it free',
      unknowns: ['whether anybody would pay for a dataset like this'],
      sources: ['https://forum.example/1', 'https://registry.example/x'] });
    if (!('opportunityId' in done)) throw new Error(done.refused);
    const open = await openUnknowns(done.opportunityId);
    expect(open.filter((u) => u.blocking)).toHaveLength(1);
    expect((await openSeeds(OWNER)).map((s) => s.id)).not.toContain(seedId);
  });
});
