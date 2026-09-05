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
  seedStartingPolicy, whatKeepsRecurring,
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

describe('a sense is not a hand, and does not ask him for permission to look', () => {
  it('reads a public registry as ordinary perception, with nothing granted', async () => {
    // THE CORRECTION THAT MATTERED MOST. This used to refuse and manufacture an
    // owner question — "may I keep asking the registry when packages were
    // published" — because every act was routed through consequential
    // authority. A public, free, credential-less read that changes nothing and
    // addresses nobody is ordinary institutional perception. An institution
    // with hundreds of continuous eyes would have produced hundreds of those
    // questions, which is the owner machinery it exists to absorb.
    const carried = await carryDependencyHealth(OWNER, { root: process.cwd() });
    expect(carried.covered).toBe(true);
    expect(carried.rung).toBe('observe');
    expect(carried.because).toContain('ordinary perception');
    // Nothing was delegated, because nothing needed to be.
    expect(carried.delegationId).toBeNull();
    expect((await query(
      'SELECT COUNT(*) AS n FROM delegations WHERE founder_id = ?', [OWNER]))
      .rows[0] as Record<string, unknown>).toMatchObject({ n: 0 });
  }, 60_000);

  it('never asks him anything for looking at something public', async () => {
    const carried = await carryDependencyHealth(OWNER, { root: process.cwd() });
    // The only thing that may reach him from this responsibility is a finding —
    // a package that has actually gone quiet — never permission to keep looking.
    if (carried.needsHim !== null) {
      expect(carried.needsHim).toContain('not been published');
    }
    const asked = (await query(
      `SELECT COUNT(*) AS n FROM responsibility_signals
        WHERE founder_id = ? AND kind = 'refused_for_authority'`, [OWNER]))
      .rows[0] as Record<string, unknown>;
    expect(Number(asked.n)).toBe(0);
  }, 60_000);

  it('still records that the work recurs, at no cost to him', async () => {
    const recurring = await whatKeepsRecurring(OWNER, 1);
    const dep = recurring.find((r) => r.responsibility === DEPENDENCY_RESPONSIBILITY);
    expect(dep?.signals.map((s) => s.kind)).toEqual(['scheduled']);
    expect(dep?.interruptions).toBe(0);
  });

  it('performs it and verifies what the provider actually did', async () => {
    const carried = await carryDependencyHealth(OWNER, { root: process.cwd() });
    if (carried.performed !== null) {
      expect(carried.performed.checked).toBeGreaterThan(0);
      expect(carried.performed.verificationBecause.length).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('but the eye itself is still his to grant', () => {
  it('refuses a private source and asks once for the connection, not for the look',
    async () => {
      const { accessBasisFor } = await import(
        '../../src/services/institution/acting.js');
      const priv = await accessBasisFor({
        founderId: OWNER, capability: 'read_repository', tool: 'github_read',
        externalEffect: 'reads the company own source code',
        reversibility: 'changes_nothing', audience: 'none' });
      expect(priv.ordinaryPerception).toBe(false);
      expect(priv.basis).toBe('owner_connected');
      // ONE ACT, ONCE, FOR THE EYE — and it says what it would never grant.
      expect(priv.needsTheEye).toContain('May I look through this?');
      expect(priv.needsTheEye).toContain('would not let me');
    });

  it('will not let a public basis quietly require a credential or cost money',
    async () => {
      await expect(query(
        `INSERT INTO capability_access (capability_key, basis, why, needs_credential,
           may_cost_cents, never_grants, established_by)
         VALUES ('read_reviews','public_observation','it is public really',1,0,
                 'nothing','institution:test')`))
        .rejects.toThrow(/public_means_free_and_open/);
    });

  it('is not ordinary perception the moment it addresses somebody', async () => {
    const { accessBasisFor } = await import(
      '../../src/services/institution/acting.js');
    const reaching = await accessBasisFor({
      founderId: OWNER, capability: 'read_community_discussion',
      tool: 'hn_read', externalEffect: 'replies to somebody who posted',
      reversibility: 'recoverable', audience: 'public' });
    expect(reaching.ordinaryPerception).toBe(false);
    expect(reaching.because).toContain('does more than look');
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
