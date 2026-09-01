process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity, FOUNDRY_IDENTITY_KEY } from '../../src/services/system-identity.js';
import {
  observeFoundryRepositoryReality, describeOwnSelfMaintenance,
} from '../../src/services/foundry/self-observation.js';

// =============================================================================
// EIGHT QUESTIONS HE COULD NOT ANSWER.
//
// Before a responsibility can be watched or carried, the institution needs
// eight facts about it — what it is for, what good looks like, what must never
// happen while it is handled. For a company's own obligations the founder is
// the only one who knows, so asking him is right.
//
// The first responsibility this institution ever took up is its OWN upkeep, and
// there the asking was backwards. The owner's page asked him "What is
// 'regenerate the committed schema snapshot after a migration changes the
// schema' actually for?" — a question about internals he did not build, whose
// only available answer was a guess. A guess typed to clear a form becomes an
// institutional fact and gets cited later in an authority request.
//
// So Foundry answers, from words written and reviewed in the repository, and
// every claim says in its own derivation that Foundry described itself. He can
// still correct any of them, and his version then stands.
//
// Understanding is not authority: this opens the rung where the obligation may
// be WATCHED. Changing one file still needs the bounded, expiring, revocable
// grant only he can give.
// =============================================================================

const OWNER = 'eq_owner';
const FOUNDRY = 'eq_foundry';

const claims = async (responsibilityId: string) => (await query(
  `SELECT predicate, derivation_method, value_json, epistemic_status
     FROM reconstruction_claims WHERE product_id=? AND subject=? ORDER BY predicate`,
  [FOUNDRY, `responsibility:${responsibilityId}`],
)).rows as unknown as Array<Record<string, unknown>>;

let responsibilityId: string;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'clerk_eq', 'owner@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Foundry',?,'active')",
    [FOUNDRY, OWNER]);
  await establishSystemIdentity(FOUNDRY_IDENTITY_KEY, FOUNDRY, 'test');

  await observeFoundryRepositoryReality();
  const { promoteResponsibilityCandidate } = await import(
    '../../src/services/institution/responsibility-candidate.js');
  const candidate = (await query(
    'SELECT id FROM responsibility_candidates WHERE product_id=?', [FOUNDRY],
  )).rows[0] as Record<string, unknown>;
  responsibilityId = await promoteResponsibilityCandidate({
    productId: FOUNDRY, candidateId: String(candidate.id),
    mechanism: 'authenticated_owner', ownerId: OWNER,
  });
});

describe('a responsibility about Foundry itself', () => {
  it('is described by Foundry, so the owner is never asked to invent it', async () => {
    expect(await claims(responsibilityId)).toHaveLength(0);

    await describeOwnSelfMaintenance({ productId: FOUNDRY });

    const written = await claims(responsibilityId);
    const { requiredUnderstandingFacts } = await import(
      '../../src/services/institution/responsibility-understanding.js');
    expect(written.map((c) => String(c.predicate)).sort())
      .toEqual([...requiredUnderstandingFacts('development')].sort());

    // PROVENANCE, so no reader mistakes these for the owner's words.
    for (const claim of written) {
      expect(String(claim.derivation_method)).toBe('foundry describing its own upkeep');
      expect(String(claim.value_json)).toContain('statement');
    }
  });

  it('opens the rung the ladder needs, and no more than that', async () => {
    const { projectResponsibilityUnderstanding, earnResponsibilityUnderstanding } = await import(
      '../../src/services/institution/responsibility-understanding.js');

    const before = await projectResponsibilityUnderstanding(FOUNDRY, responsibilityId);
    expect(before.missingCriticalFacts).toEqual([]);
    expect(before.unresolvedFacts).toEqual([]);
    // Authority is still required. Describing itself granted nothing.
    expect(before.authorityRequired).toBe(true);

    const earned = await earnResponsibilityUnderstanding(FOUNDRY, responsibilityId);
    expect(earned.state).toBe('understood');

    // And still nothing may be changed: no consent exists to act on.
    const consents = await query(
      'SELECT COUNT(*) AS n FROM autonomy_consents WHERE product_id=?', [FOUNDRY]);
    expect(Number((consents.rows[0] as Record<string, unknown>).n)).toBe(0);
  });

  it('never overwrites a fact the owner has stated himself', async () => {
    await query(
      `UPDATE reconstruction_claims SET derivation_method='authenticated founder assertion'
        WHERE product_id=? AND subject=? AND predicate='purpose'`,
      [FOUNDRY, `responsibility:${responsibilityId}`]);

    await describeOwnSelfMaintenance({ productId: FOUNDRY });

    const purpose = (await claims(responsibilityId))
      .filter((c) => String(c.predicate) === 'purpose');
    expect(purpose).toHaveLength(1);
    expect(String(purpose[0].derivation_method)).toBe('authenticated founder assertion');
  });

  it('says nothing about a responsibility that is not its own upkeep', async () => {
    const OTHER = 'eq_other';
    await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Someone Else',?,'active')",
      [OTHER, OWNER]);
    // Through the real intake, not a hand-built row: the database refused the
    // hand-built one, correctly, and a test that enters by a door production
    // does not have proves nothing about production.
    const { reportedObligation } = await import('../fixtures/responsibility-state.js');
    await reportedObligation(OTHER, OWNER, { kind: 'development', what: 'ship the mobile app' });

    await describeOwnSelfMaintenance({ productId: OTHER });

    const written = (await query(
      'SELECT COUNT(*) AS n FROM reconstruction_claims WHERE product_id=?', [OTHER]));
    // Every other company's obligations are still the founder's to explain.
    expect(Number((written.rows[0] as Record<string, unknown>).n)).toBe(0);
  });
});
