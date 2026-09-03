process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { formClaim, observe } from '../../src/services/venture/market-evidence.js';
import {
  bury, openSeeds, promote, sow, whatItWouldTakeToBelieve, whyWeStartedLooking,
} from '../../src/services/venture/seeds.js';
import { openMandate } from '../../src/services/venture/mandate.js';

// =============================================================================
// A SEED IS NOT A CANDIDATE.
//
// Discovery begins with one weak signal and needs something to organise the
// next investigation around. A seed means only THIS MAY BE WORTH
// INVESTIGATING; it is never evidence that an opportunity exists.
//
// PROMOTION TAKES INDEPENDENT WAYS OF KNOWING, not a count of sources. Two APIs
// can say the same thing; two communities can repeat one story. A registry read
// fifteen times is one way of knowing, and the rule says so rather than
// flattering the total.
// =============================================================================

const OWNER = 'seed_owner';
let mandateId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_seed', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'find one',
    shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  mandateId = opened.id;
});

async function seedFromSignal(text: string): Promise<{ seedId: string; claimId: string }> {
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
  const seedId = sown;
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seedId, claimId]);
  return { seedId, claimId };
}

describe('where a seed may come from', () => {
  it('a signal names the observation it came from', async () => {
    const { seedId } = await seedFromSignal('every scheduler gets daylight saving wrong');
    expect((await openSeeds(OWNER)).map((s) => s.id)).toContain(seedId);
    await expect(query(
      `INSERT INTO opportunity_seeds (id, founder_id, seed, origin, origin_said, evidence_mode)
       VALUES ('bad_signal', ?, 'a thing', 'signal', 'somebody said so', 'real')`, [OWNER]))
      .rejects.toThrow(/signal_without_an_observation/);
  });

  it('reasoning may generate the hypothesis, and may not carry evidence', async () => {
    // The model may generate questions. It may not generate the facts that
    // validate them, and a reasoned seed holding an observation would be
    // reasoning dressed as evidence.
    const reasoned = await sow({
      founderId: OWNER, mandateId,
      seed: 'a deadline dataset sold per download would suit this portfolio',
      origin: 'reasoned',
      originSaid: 'the portfolio is concentrated in subscriptions and this is not one',
      evidenceMode: 'real' });
    expect(typeof reasoned).toBe('string');

    const observationId = (await query(
      'SELECT id FROM market_observations LIMIT 1', []))
      .rows[0] as Record<string, unknown>;
    await expect(query(
      `INSERT INTO opportunity_seeds
         (id, founder_id, seed, origin, origin_said, origin_observation_id, evidence_mode)
       VALUES ('bad_reason', ?, 'a thing', 'reasoned', 'I reasoned it', ?, 'real')`,
      [OWNER, String(observationId.id)]))
      .rejects.toThrow(/reasoning_is_not_evidence/);
  });
});

describe('what it would take to believe it', () => {
  it('counts ways of knowing, not observations', async () => {
    const { seedId, claimId } = await seedFromSignal('nobody can parse recurrence rules');
    // Fifteen more readings of the same kind of source.
    for (let i = 0; i < 15; i += 1) {
      await observe({ founderId: OWNER, claimId, sourceType: 'community',
        source: `https://forum.example/${String(i)}`, saw: 'another person saying it',
        bearing: 'supports', directness: 'direct', observedAt: new Date(),
        evidenceMode: 'real' });
    }
    const believe = await whatItWouldTakeToBelieve(seedId);
    expect(believe.have).toHaveLength(1);
    expect(believe.enough).toBe(false);
    expect(believe.sentence).toContain('Reading the same kind of source again');
  });

  it('a second genuinely different way of knowing is enough', async () => {
    const seedId = (await openSeeds(OWNER)).find((s) => s.seed.includes('recurrence'))?.id ?? '';
    const claimId = (await query(
      'SELECT id FROM market_claims WHERE seed_id = ? LIMIT 1', [seedId]))
      .rows[0] as Record<string, unknown>;
    await observe({ founderId: OWNER, claimId: String(claimId.id), sourceType: 'directory',
      source: 'https://registry.example/x', saw: 'nothing maintained does this',
      bearing: 'supports', directness: 'direct', observedAt: new Date(),
      evidenceMode: 'real' });
    const believe = await whatItWouldTakeToBelieve(seedId);
    expect(believe.have.map((h) => h.stance).sort()).toEqual(['problem_pain', 'substitute']);
    expect(believe.enough).toBe(true);
  });

  it('a rehearsal is never one of the ways, and cannot even be filed as one', async () => {
    const { seedId, claimId } = await seedFromSignal('something only the rehearsal saw');
    // A guarantee stronger than the stance count: the evidence-mode boundary
    // refuses an invented observation on a real claim outright, so rehearsal
    // cannot reach a real seed at all. The stance rule is the second line, not
    // the first.
    await expect(observe({ founderId: OWNER, claimId, sourceType: 'reference_world',
      source: 'reference-world:x', saw: 'invented', bearing: 'supports',
      directness: 'direct', observedAt: new Date(), evidenceMode: 'reference' }))
      .rejects.toThrow(/claim_mode_mismatch/);

    const believe = await whatItWouldTakeToBelieve(seedId);
    expect(believe.have.map((h) => h.stance)).toEqual(['problem_pain']);
    expect(believe.enough).toBe(false);
  });
});

describe('promotion', () => {
  it('refuses a candidate built on one plausible story', async () => {
    const thin = (await openSeeds(OWNER)).find((s) => s.seed.includes('daylight'))?.id ?? '';
    const tried = await promote({
      seedId: thin, headline: 'A scheduler that handles daylight saving',
      whoHasIt: 'developers', theProblem: 'DST breaks schedules',
      whyItMight: 'everyone complains', killThesis: 'the platform fixes it',
      unknowns: ['whether anyone would pay'], sources: ['https://forum.example/1'] });
    expect('refused' in tried).toBe(true);
    if ('refused' in tried) {
      expect(tried.refused).toContain('genuinely different ways of knowing');
      expect(tried.refused).toContain('one plausible story about one source is not that');
    }
  });

  it('promotes when the evidence knows differently, and keeps why we started', async () => {
    const ready = (await openSeeds(OWNER)).find((s) => s.seed.includes('recurrence'))?.id ?? '';
    const done = await promote({
      seedId: ready, headline: 'A recurrence rule parser people can rely on',
      whoHasIt: 'developers scheduling anything', theProblem: 'the rules are subtle',
      whyItMight: 'nothing maintained does it and people keep saying so',
      killThesis: 'a platform ships it and the need disappears',
      unknowns: ['whether anyone would pay'],
      sources: ['https://forum.example/1', 'https://registry.example/x'] });
    expect('opportunityId' in done).toBe(true);
    if (!('opportunityId' in done)) return;

    // SYNTHESIS MUST NOT SEVER A VENTURE FROM WHAT MADE ANYBODY CURIOUS.
    const why = await whyWeStartedLooking(done.opportunityId);
    expect(why?.origin).toBe('signal');
    expect(why?.observation).toContain('recurrence rules');
    // And the seed is gone from the open list, once.
    expect((await openSeeds(OWNER)).map((s) => s.id)).not.toContain(ready);
    const again = await promote({ seedId: ready, headline: 'x', whoHasIt: 'x',
      theProblem: 'x', whyItMight: 'x', killThesis: 'x', unknowns: [], sources: [] });
    expect('refused' in again).toBe(true);
  });
});

describe('most seeds die', () => {
  it('and the reason is kept, so the same thin idea stays dead', async () => {
    const thin = (await openSeeds(OWNER)).find((s) => s.seed.includes('daylight'))?.id ?? '';
    await bury({ seedId: thin,
      because: 'one way of knowing after three weeks; nothing else ever agreed' });
    expect((await openSeeds(OWNER)).map((s) => s.id)).not.toContain(thin);
    const row = (await query(
      'SELECT buried_because FROM opportunity_seeds WHERE id = ?', [thin]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.buried_because)).toContain('nothing else ever agreed');
    await expect(query(
      `UPDATE opportunity_seeds SET buried_at = datetime('now') WHERE id = ?`, [thin]))
      .rejects.toThrow(/already_decided/);
  });

  it('and the same idea in different words meets the reason it died', async () => {
    // The gate that found this was right: a reason nobody reads is a filing
    // cabinet, not a memory.
    const again = await sow({
      founderId: OWNER, mandateId,
      seed: 'a scheduler that finally handles daylight saving properly',
      origin: 'reasoned', originSaid: 'it came up again', evidenceMode: 'real' });
    expect(typeof again).toBe('object');
    if (typeof again === 'object') {
      expect(again.alreadyBuried.because).toContain('nothing else ever agreed');
    }
  });
});
