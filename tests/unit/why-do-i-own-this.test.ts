process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { formClaim, observe } from '../../src/services/venture/market-evidence.js';
import { promote, sow, whyWeOwnThis } from '../../src/services/venture/seeds.js';
import { openMandate } from '../../src/services/venture/mandate.js';

// =============================================================================
// WHY DO I OWN THIS?
//
// The question he will actually ask, in two years, about an asset earning $300
// a month that he has no memory of choosing. Discovery builds the answer with
// enormous care — asset to candidate to seed to interpretation to the verbatim
// sentence a person wrote — and `products` had no column pointing back, so the
// chain died at the candidate and the answer was unreachable.
//
// Cheap now, impossible later: a link not written at birth cannot be recovered
// once the asset is running.
// =============================================================================

const OWNER = 'own_owner';
// A second founder, because one search runs at a time: the rehearsal candidate
// needs its own mandate and the real one is still open.
const REHEARSER = 'own_rehearser';
let mandateId = '';
let realOpportunity = '';
let referenceOpportunity = '';
let otherRealOpportunity = '';

async function candidate(text: string): Promise<string> {
  const who = OWNER;
  const mode = 'real' as const;
  const claimId = await formClaim({ founderId: who, evidenceMode: mode,
    claim: `about: ${text}` });
  const observationId = await observe({
    founderId: who, claimId,
    sourceType: 'community',
    source: mode === 'real' ? 'https://forum.example/1' : 'reference-world:1',
    saw: text, bearing: 'supports', directness: 'direct',
    observedAt: new Date(), evidenceMode: mode });
  const sown = await sow({ founderId: who, mandateId, seed: `worth a look: ${text}`,
    origin: 'signal', originSaid: text, originObservationId: observationId,
    evidenceMode: mode });
  if (typeof sown !== 'string') throw new Error('already buried');
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [sown, claimId]);
  await observe({ founderId: who, claimId,
    sourceType: 'directory',
    source: mode === 'real' ? 'https://registry.example/x' : 'reference-world:2',
    saw: 'nothing maintained does this', bearing: 'supports', directness: 'direct',
    observedAt: new Date(), evidenceMode: mode });
  const done = await promote({
    seedId: sown, headline: text.slice(0, 60), whoHasIt: 'somebody',
    theProblem: text, whyItMight: 'two ways of knowing said so',
    killThesis: 'a platform ships it',
    unknowns: ['how many maintained libraries cover this'],
    sources: ['https://forum.example/1'] });
  if (!('opportunityId' in done)) throw new Error(done.refused);
  return done.opportunityId;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_own', 'owner@example.com', 'Owner']);
  const realMandate = await openMandate({ founderId: OWNER, statement: 'find one',
    shape: null, evidenceMode: 'real' });
  if ('refused' in realMandate) throw new Error(realMandate.refused);
  mandateId = realMandate.id;
  realOpportunity = await candidate('nobody can parse recurrence rules');

  // A second real candidate, inserted rather than discovered — this fixture
  // only needs something valid to point at.
  otherRealOpportunity = 'opp_real_2';
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, unknowns_json, sources_json, evidence_mode)
     VALUES (?,?,?,'A deadline dataset','compliance teams','sourcing is manual',
             'two ways of knowing said so','a regulator publishes it free',
             '[]','[]','real')`,
    [otherRealOpportunity, realMandate.id, OWNER]);

  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [REHEARSER, 'clerk_reh', 'rehearse@example.com', 'Rehearser']);
  const rehearsal = await openMandate({ founderId: REHEARSER, statement: 'rehearse one',
    shape: null, evidenceMode: 'reference' });
  if ('refused' in rehearsal) throw new Error(rehearsal.refused);
  mandateId = rehearsal.id;
  // A rehearsal candidate is INSERTED, never promoted: `whatItWouldTakeToBelieve`
  // refuses to count a reference observation as a way of knowing, so the real
  // promotion path cannot produce one. That refusal is the first line of the
  // reality boundary; the lineage trigger below is the second.
  referenceOpportunity = 'opp_reference';
  await query(
    `INSERT INTO venture_opportunities
       (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might,
        kill_thesis, unknowns_json, sources_json, evidence_mode)
     VALUES (?,?,?,'A rehearsed problem','somebody','rehearsed','rehearsed',
             'rehearsed','[]','[]','reference')`,
    [referenceOpportunity, rehearsal.id, REHEARSER]);
});

describe('an asset remembers what made anybody curious', () => {
  it('walks from the asset back to the sentence somebody wrote', async () => {
    await query(
      `INSERT INTO products (id, name, owner_id, status, reality, from_opportunity_id)
       VALUES ('p_real','Recurrence',?,'active','real',?)`, [OWNER, realOpportunity]);
    const why = await whyWeOwnThis('p_real');
    expect(why?.opportunityId).toBe(realOpportunity);
    expect(why?.observation).toContain('recurrence rules');
    expect(why?.origin).toBe('signal');
  });

  it('says nothing rather than guessing, for an asset with no recorded lineage', async () => {
    await query(
      `INSERT INTO products (id, name, owner_id, status, reality)
       VALUES ('p_bought','Bought',?,'active','real')`, [OWNER]);
    expect(await whyWeOwnThis('p_bought')).toBeNull();
  });

  it('refuses to let a lineage be rewritten', async () => {
    await expect(query(
      'UPDATE products SET from_opportunity_id = ? WHERE id = ?',
      [otherRealOpportunity, 'p_real'])).rejects.toThrow(/product_lineage:write_once/);
  });

  it('lets an asset that never had one be attributed by hand, once', async () => {
    await query('UPDATE products SET from_opportunity_id = ? WHERE id = ?',
      [realOpportunity, 'p_bought']);
    expect((await whyWeOwnThis('p_bought'))?.opportunityId).toBe(realOpportunity);
    await expect(query(
      'UPDATE products SET from_opportunity_id = NULL WHERE id = ?', ['p_bought']))
      .rejects.toThrow(/product_lineage:write_once/);
  });

  it('refuses to let a rehearsal father a real company', async () => {
    await expect(query(
      `INSERT INTO products (id, name, owner_id, status, reality, from_opportunity_id)
       VALUES ('p_bad','Fake',?,'active','real',?)`, [OWNER, referenceOpportunity]))
      .rejects.toThrow(/product_lineage:evidence_mode_mismatch/);
  });
});
