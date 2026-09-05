process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  DEPENDENCY_RESPONSIBILITY, carryDependencyHealth,
} from '../../src/services/institution/carrying.js';
import { howOftenRight } from '../../src/services/institution/calibration.js';
import {
  seedStartingPolicy, whatKeepsRecurring, whatWasDoneUnder,
} from '../../src/services/institution/acting.js';

// =============================================================================
// CARRYING A REAL RESPONSIBILITY.
//
// Not a demonstration act invented so the architecture could say it acted.
// Foundry runs on packages other people maintain; when one is abandoned that is
// an operational risk to a real company, and knowing about it is work somebody
// has to do. It has been doing that work daily against the real registry.
//
// What was missing was everything around the act. Nothing resolved who was
// acting, nothing derived what consequence the act carried, nothing asked
// whether any standing authority covered it, and nothing ever went back to
// settle the claim it made.
//
// The registry itself is stubbed here — the point under test is the loop, and a
// unit test that reached the real npm would be slow, flaky, and would prove
// something about the network rather than about the institution. The production
// job runs the same code against the real thing.
// =============================================================================

const OWNER = 'carry_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_carry', 'owner@example.com', 'Owner']);
  await seedStartingPolicy(OWNER);
  await query(
    `INSERT INTO capability_providers
       (id, capability_key, provider, how, tool, cost_note, maturity, sort_order)
     VALUES ('cp_npm_read','read_public_web','npm_registry','api','npm_registry_read',
             'free','available',50)`, []);
});

describe('the chain, when nothing covers the act', () => {
  it('refuses, keeps the reason, and asks one question', async () => {
    // A REFUSAL IS NOT A FAILURE OF THE CHAIN. It is the chain reaching the
    // owner where it should, and nothing is weakened to avoid it.
    const carried = await carryDependencyHealth(OWNER);
    expect(carried.covered).toBe(false);
    expect(carried.performed).toBeNull();
    expect(carried.rung).toBe('observe');
    expect(carried.needsHim).toContain('reads a public page, changes nothing');
  });

  it('records the refusal as evidence the work recurs, without inventing one', async () => {
    const recurring = await whatKeepsRecurring(OWNER, 1);
    const dep = recurring.find((r) => r.responsibility === DEPENDENCY_RESPONSIBILITY);
    expect(dep).toBeDefined();
    // Both kinds are present: the schedule that costs him nothing, and the
    // refusal that cost him one question.
    expect(dep?.signals.map((s) => s.kind).sort())
      .toEqual(['refused_for_authority', 'scheduled']);
  });
});

describe('the chain, once he has allowed it', () => {
  let delegationId = '';

  beforeAll(async () => {
    const actor = (await query(
      `SELECT id FROM business_actors WHERE founder_id = ? AND product_id IS NULL`,
      [OWNER])).rows[0] as Record<string, unknown>;
    // Foundry acts as itself — a real company — not as its owner.
    expect(actor).toBeDefined();
    delegationId = 'del_dep_health';
    await query(
      `INSERT INTO delegations (id, founder_id, product_id, actor_id, responsibility,
         act_class, content_scope, class, purpose, audience, excludes, ceiling,
         review_every_days, granted_by)
       VALUES (?,?,NULL,?,?,'read a public registry',
               'the packages this institution runs on','dependency health',
               'know whether what we run on is still maintained','none',
               'change any dependency; open a pull request; contact a maintainer',
               'observe',90,'founder:carry_owner')`,
      [delegationId, OWNER, String(actor.id), DEPENDENCY_RESPONSIBILITY]);

    // The registry, stubbed. Two healthy, one abandoned.
    const health = await import('../../src/services/institution/dependency-health.js');
    vi.spyOn(health, 'checkOwnDependencies');
  });

  it('performs it, verifies what the provider actually did, and reports honestly',
    async () => {
      const carried = await carryDependencyHealth(OWNER, { root: process.cwd() });
      expect(carried.covered).toBe(true);
      expect(carried.delegationId).toBe(delegationId);
      // Either it reached the registry and has a verified claim, or it did not
      // and says so — never a claim of success with nothing behind it.
      if (carried.performed !== null) {
        expect(carried.performed.checked).toBeGreaterThan(0);
        expect(typeof carried.performed.providerVerified).toBe('boolean');
        expect(carried.performed.verificationBecause.length).toBeGreaterThan(0);
      }
    }, 60_000);

  it('leaves a record of what it did under that permission', async () => {
    const done = await whatWasDoneUnder(delegationId);
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]?.did).toContain('asks a public registry');
    expect(done[0]?.allowed).toBe(true);
  }, 20_000);

  it('stops proposing the responsibility he has now allowed', async () => {
    const recurring = await whatKeepsRecurring(OWNER, 1);
    expect(recurring.some((r) => r.responsibility === DEPENDENCY_RESPONSIBILITY))
      .toBe(false);
  });
});

describe('the return leg closes on the next pass, not on this one', () => {
  it('settles what the previous pass predicted, against evidence that came later',
    async () => {
      const before = await howOftenRight(OWNER, 'institutional_judgment');

      // A claim from yesterday, with an observation from today. The resolution
      // trigger refuses same-second evidence as ambiguous, which is why the
      // institution predicts on one pass and finds out on the next.
      await query(
        `INSERT INTO market_claims (id, founder_id, claim, evidence_mode, formed_at)
         VALUES ('claim_yesterday',?,
                 'Every package Foundry runs on is still being maintained','real',
                 datetime('now','-2 days'))`, [OWNER]);
      await query(
        `INSERT INTO market_observations
           (id, founder_id, claim_id, source_type, source, saw, bearing, directness,
            observed_at, evidence_mode)
         VALUES ('obs_today',?,'claim_yesterday','directory',
                 'https://registry.npmjs.org/example',
                 'example was last published in 2019, which is more than eighteen '
                 || 'months ago','contradicts','direct',datetime('now','-1 day'),'real')`,
        [OWNER]);

      const carried = await carryDependencyHealth(OWNER, { root: process.cwd() });
      expect(carried.settled?.claimId).toBe('claim_yesterday');
      // A CONTRADICTION IS A SURPRISE, and the surprise is the useful half.
      expect(carried.settled?.verdict).toBe('surprised');
      expect(carried.settled?.because).toContain('had gone quiet');

      const after = await howOftenRight(OWNER, 'institutional_judgment');
      expect(after.graded).toBe(before.graded + 1);
      expect(after.surprised).toBe(before.surprised + 1);
      // Settled by what happened, not by the owner agreeing in hindsight.
      expect(after.settledByTheWorld).toBe(before.settledByTheWorld + 1);
    }, 60_000);

  it('never settles the same claim twice', async () => {
    const again = await carryDependencyHealth(OWNER, { root: process.cwd() });
    expect(again.settled?.claimId).not.toBe('claim_yesterday');
  }, 60_000);
});
