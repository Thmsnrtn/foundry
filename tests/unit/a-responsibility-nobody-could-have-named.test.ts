process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity, FOUNDRY_IDENTITY_KEY } from '../../src/services/system-identity.js';
import {
  observeFoundryRepositoryReality, observeFoundryBaselineLiveness,
  SCHEMA_SNAPSHOT_CHECK, BASELINE_LIVENESS_CHECK, SELF_MAINTENANCE_SCOPES,
} from '../../src/services/foundry/self-observation.js';

// =============================================================================
// A RESPONSIBILITY NOBODY COULD HAVE NAMED.
//
// The owner's next step after establishing the company was to tell Foundry what
// it owes — and the only intake for that is the report form, where the kind is
// picked from eight plain sentences. "Keep the committed schema snapshot fresh"
// reads as "something that has to be kept working". That is `maintenance`,
// which maps to the `operations` capability, and
// `beginFounderDevelopmentShadowing` admits `development` and nothing else.
//
// So the correct owner action led nowhere: the obligation would be recorded,
// acknowledged, and never watched, with no page saying why. Foundry knew which
// capability the obligation needed — `SELF_MAINTENANCE_SCOPES` states the path,
// the change class and the sentence to show — and made the owner guess it from
// prose instead.
//
// It proposes now. A candidate is non-executable and pending; recognising it is
// an authenticated owner act, refusing it is one tap that sticks, and neither
// grants any authority to change anything. Proposing is not observing,
// observing is not carrying, and carrying still needs the bounded, revocable,
// time-limited grant.
// =============================================================================

const OWNER = 'sm_owner';
const FOUNDRY = 'sm_foundry';

const candidates = async () => (await query(
  'SELECT * FROM responsibility_candidates WHERE product_id=? ORDER BY created_at,id', [FOUNDRY],
)).rows as unknown as Array<Record<string, unknown>>;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'clerk_sm', 'owner@example.com']);
  await query("INSERT INTO products (id,name,owner_id,status) VALUES (?,'Foundry',?,'active')",
    [FOUNDRY, OWNER]);
  await establishSystemIdentity(FOUNDRY_IDENTITY_KEY, FOUNDRY, 'test establishes the identity');
});

describe('observing itself', () => {
  it('offers the obligation the check implies, in the words the grant will use', async () => {
    const outcome = await observeFoundryRepositoryReality();
    expect(outcome.observed).toBe(true);

    const rows = await candidates();
    expect(rows).toHaveLength(1);
    const c = rows[0];
    expect(c.convergence_key).toBe(`self_maintenance:${SCHEMA_SNAPSHOT_CHECK}`);
    // The same sentence the authority request shows, so the owner reads one
    // description of the obligation from recognition through to grant.
    expect(c.proposed_responsibility).toBe(SELF_MAINTENANCE_SCOPES[SCHEMA_SNAPSHOT_CHECK].plainly);
    // The capability the watch rung requires, set by construction rather than
    // by the owner picking the right sentence out of eight.
    expect(c.capability_dependency).toBe('development');
    expect(c.authority_required).toBe(1);
    // Deterministic, so no confidence is invented — and promotable, which
    // `unresolved` is not: migration 108's `not_promotable` excludes it, so
    // proposing it that way would have been a button that could never work.
    expect(c.epistemic_status).toBe('known');
    expect(c.confidence).toBeNull();
    expect(c.status).toBe('pending');

    // It cites the observation it came from, and that observation exists.
    const refs = JSON.parse(String(c.evidence_refs_json)) as Array<{ kind: string; id: string }>;
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe('signal_event');
    const evidence = await query('SELECT source FROM signal_events WHERE id=?', [refs[0].id]);
    expect(evidence.rows).toHaveLength(1);
    expect((evidence.rows[0] as Record<string, unknown>).source).toBe('development_verification');
  });

  it('does not ask twice for the same obligation', async () => {
    await observeFoundryRepositoryReality();
    await observeFoundryRepositoryReality();
    expect(await candidates()).toHaveLength(1);
  });

  it('offers nothing for a check no grant could authorise', async () => {
    // `ratchet-baseline-liveness` has no entry in SELF_MAINTENANCE_SCOPES, so
    // there is no path by which Foundry could ever be permitted to do the
    // upkeep it describes. Offering it would be a promise.
    expect(SELF_MAINTENANCE_SCOPES[BASELINE_LIVENESS_CHECK]).toBeUndefined();
    const outcome = await observeFoundryBaselineLiveness();
    expect(outcome.observed).toBe(true);
    expect((await candidates()).map((c) => c.convergence_key))
      .toEqual([`self_maintenance:${SCHEMA_SNAPSHOT_CHECK}`]);
  });
});

describe('the owner deciding', () => {
  it('recognises it into a development responsibility, and a refusal is not re-asked', async () => {
    const { promoteResponsibilityCandidate, decideResponsibilityCandidate } = await import(
      '../../src/services/institution/responsibility-candidate.js');
    const [candidate] = await candidates();

    const responsibilityId = await promoteResponsibilityCandidate({
      productId: FOUNDRY, candidateId: String(candidate.id),
      mechanism: 'authenticated_owner', ownerId: OWNER,
    });
    const responsibility = await query(
      'SELECT capability,title FROM institutional_responsibilities WHERE id=? AND product_id=?',
      [responsibilityId, FOUNDRY]);
    expect(responsibility.rows).toHaveLength(1);
    // The rung `beginFounderDevelopmentShadowing` admits.
    expect((responsibility.rows[0] as Record<string, unknown>).capability).toBe('development');

    // Observing again after a decision does not re-propose: the convergence key
    // returns the decided candidate. A refusal has to stick for the same
    // reason, so the count is what is asserted, not the status.
    await observeFoundryRepositoryReality();
    expect(await candidates()).toHaveLength(1);

    await expect(decideResponsibilityCandidate({
      productId: FOUNDRY, candidateId: String(candidate.id), decision: 'rejected',
      ownerId: OWNER, reason: 'I do not want Foundry keeping this',
    })).rejects.toThrow();  // already promoted; a decided candidate is decided
  });
});

describe('the page the owner reads', () => {
  it('does not call a day quiet while a proposal is waiting on him', async () => {
    // A second company, so the pending candidate is the only thing that could
    // make its Letter anything other than quiet.
    const OTHER = 'sm_other';
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      [OTHER, 'clerk_sm2', 'other@example.com']);
    await query("INSERT INTO products (id,name,owner_id,status) VALUES ('sm_p','Quiet Co',?,'active')",
      [OTHER]);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('sm_sig','sm_p','company_observation_baseline','company_observation_baseline:observed','low','{}','something')`);

    const { proposeResponsibilityCandidate } = await import(
      '../../src/services/institution/responsibility-candidate.js');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('founder' as never, { id: OTHER, email: 'other@example.com' } as never);
      c.set('csrfToken' as never, 'test' as never);
      await next();
    });
    app.route('/', letterRoutes);

    const read = async () => {
      const res = await app.request('/letter', { headers: { cookie: 'selected_product=sm_p' } });
      expect(res.status).toBe(200);
      return res.text();
    };

    await proposeResponsibilityCandidate({
      productId: 'sm_p', convergenceKey: 'something-only-he-can-settle',
      proposedResponsibility: 'chase the unpaid invoice from March',
      evidenceRefs: [{ kind: 'signal_event', id: 'sm_sig' }],
      derivationMethod: 'test', rationale: 'test', epistemicStatus: 'known',
      observedAt: new Date(),
    });

    const body = await read();
    // The quiet card is the defect here, not the goal: it replaces the body,
    // and the body is where the proposal is.
    expect(body).not.toContain('Nothing needs you');
    expect(body).toContain('chase the unpaid invoice from March');
    expect(body).toContain('Possible responsibilities requiring your judgment');
  });
});
