process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  listGrantableDevelopmentResponsibilities, grantDevelopmentAuthority,
  getCurrentDevelopmentAuthority, revokeDevelopmentAuthority, CONSTITUTIONAL_PATHS,
} from '../../src/services/institution/development-authority.js';
import { SCHEMA_SNAPSHOT_CHECK, SNAPSHOT_PATH, SELF_MAINTENANCE_SCOPES }
  from '../../src/services/foundry/self-observation.js';
import { developmentEventType } from '../../src/services/institution/development-observation.js';

// =============================================================================
// A DOOR WITH NO HANDLE.
//
// Foundry observes its own repository on a schedule, climbs the identical
// responsibility ladder it makes every company climb, and can plan, apply,
// verify, record and roll back a change to itself. All of that was built,
// governed and reachable — except `grantDevelopmentAuthority`, which had no
// caller anywhere in the tree. The only mention of it was a comment describing
// it as "a different door and not an absent one". It was absent: the capability
// existed and nothing could start it.
//
// What the owner is asked is not which paths or which change class. It is
// whether Foundry may do one named piece of maintenance for a week. The scope
// comes from the module that owns the observation, so a form cannot widen it.
// =============================================================================

const OWNER = 'dh_owner', P = 'dh_foundry', R = 'dh_resp';

async function developmentResponsibilityInShadowing(
  id: string, productId: string, check: string,
): Promise<void> {
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
     VALUES (?,?,?,'development','understood')`,
    [id, productId, 'Keep the generated artefact consistent']);
  await query(
    `INSERT INTO reconstruction_claims
      (id,product_id,subject,predicate,value_json,epistemic_status,evidence_refs_json,derivation_method,observed_at)
     VALUES (?,?,?,'expected_observed_event',?,'known','[{"kind":"signal_event","id":"dh_sig"}]','frozen expectation',datetime('now'))`,
    [`claim_${id}`, productId, `responsibility:${id}`,
     JSON.stringify(developmentEventType(check, 'consistent'))]);
  await query(
    `INSERT INTO responsibility_shadow_expectations
      (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,
       observation_source_evidence_ref,observation_source_kind)
     VALUES (?,?,?,?,?,'signal_event:dh_sig','repository')`,
    [`expect_${id}`, id, productId, developmentEventType(check, 'consistent'),
     `reconstruction_claim:claim_${id}`]);
  await query(
    `INSERT INTO responsibility_transitions
      (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
     VALUES (?,?,'understood','shadowing','signal_event:dh_sig','watching','test')`,
    [`shadow_${id}`, id]);
}

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES (?,'dh_clerk','dh@example.com')", [OWNER]);
  await query("INSERT INTO products (id,name,owner_id) VALUES (?,'Foundry',?)", [P, OWNER]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('dh_sig',?,'repository','development_need_observed','low','{}','drift')`, [P]);
});

beforeEach(async () => {
  await query('DELETE FROM autonomy_consents');
});

/** Grant the declared scope. Each test that needs authority makes its own:
 *  `beforeEach` clears the ledger, so a grant made by one test is gone by the
 *  next, and a test that leans on another's leftovers is not a test. */
async function grantDeclaredScope(): Promise<void> {
  const scope = SELF_MAINTENANCE_SCOPES[SCHEMA_SNAPSHOT_CHECK];
  await grantDevelopmentAuthority({
    productId: P, responsibilityId: R, ownerId: OWNER,
    repository: 'foundry', allowedPathPrefixes: [scope.path],
    changeClass: scope.changeClass, requiredVerification: scope.verification,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  });
}

describe('the owner can start what Foundry has earned', () => {
  it('offers a responsibility standing in shadowing on a declared check', async () => {
    await developmentResponsibilityInShadowing(R, P, SCHEMA_SNAPSHOT_CHECK);
    const grantable = await listGrantableDevelopmentResponsibilities(P);
    expect(grantable.map((g) => g.responsibilityId)).toContain(R);
    expect(grantable.find((g) => g.responsibilityId === R)!.check).toBe(SCHEMA_SNAPSHOT_CHECK);
  });

  it('grants exactly the scope the check declared, and no more', async () => {
    await grantDeclaredScope();
    const current = await getCurrentDevelopmentAuthority(P, R);
    expect(current, 'the grant did not become current authority').not.toBeNull();
    expect(current!.allowedPathPrefixes).toEqual([SNAPSHOT_PATH]);
    expect(current!.changeClass).toBe('generated_artifact');
    expect(current!.requiredVerification.length,
      'a grant with nothing to verify it is not a grant').toBeGreaterThan(0);
  });

  it('expires, so absence of a decision withdraws it', async () => {
    await grantDeclaredScope();
    const current = await getCurrentDevelopmentAuthority(P, R);
    expect(current).not.toBeNull();
    const days = (Date.parse(current!.expiresAt) - Date.now()) / 86_400_000;
    expect(days, 'a standing grant with no end is not what was offered')
      .toBeLessThanOrEqual(7.01);
    expect(days).toBeGreaterThan(0);
  });

  it('is withdrawable, and withdrawal takes effect immediately', async () => {
    await grantDeclaredScope();
    const before = await getCurrentDevelopmentAuthority(P, R);
    await revokeDevelopmentAuthority(P, before!.consentId, OWNER);
    expect(await getCurrentDevelopmentAuthority(P, R),
      'withdrawn authority must not still be current').toBeNull();
  });
});

describe('what the door will not open', () => {
  it('does not offer a responsibility that has not reached shadowing', async () => {
    await query(
      `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
       VALUES ('dh_early',?,'Not yet','development','understood')`, [P]);
    const grantable = await listGrantableDevelopmentResponsibilities(P);
    expect(grantable.map((g) => g.responsibilityId),
      'shadowing is the rung the database requires before any grant')
      .not.toContain('dh_early');
  });

  it('does not offer a check nobody has declared a scope for', async () => {
    await developmentResponsibilityInShadowing('dh_undeclared', P, 'some-other-check');
    const grantable = await listGrantableDevelopmentResponsibilities(P);
    expect(grantable.map((g) => g.responsibilityId),
      'an undeclared check would make the owner invent a path scope')
      .not.toContain('dh_undeclared');
  });

  it('never declares a scope inside the constitutional ring', async () => {
    // The database refuses these regardless, but a scope that tried would mean
    // the offer shown to the owner was a lie about what could happen.
    for (const [check, scope] of Object.entries(SELF_MAINTENANCE_SCOPES)) {
      for (const ring of CONSTITUTIONAL_PATHS) {
        expect(scope.path.startsWith(ring),
          `${check} declares a scope inside ${ring}`).toBe(false);
      }
    }
  });
});

describe('the handle is attached to the door', () => {
  // THE WHOLE FINDING WAS A CAPABILITY NOTHING COULD REACH. A test proving the
  // grant function works, without proving a person can reach it, would rebuild
  // exactly that defect one layer up.
  it('renders the offer on Controls, where authority belongs', async () => {
    await grantDeclaredScope().catch(() => { /* offer shows either way */ });
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder', { id: OWNER, email: 'dh@example.com' }); await next(); });
    app.route('/', letterRoutes as never);

    const res = await app.request('/autopilot');
    expect(res.status, 'Controls did not render').toBe(200);
    const body = await res.text();

    expect(body, 'the offer never reaches the page').toContain("Foundry's own upkeep");
    expect(body, 'the owner is not told what Foundry would actually do')
      .toContain(SELF_MAINTENANCE_SCOPES[SCHEMA_SNAPSHOT_CHECK].plainly);
    expect(body, 'the scope the grant is bounded to is not shown').toContain(SNAPSHOT_PATH);
    expect(/action="\/autopilot\/development\/(grant|revoke)"/.test(body),
      'there is no form to act on the offer').toBe(true);
  });

  it('asks the owner for intent, never for a path scope', async () => {
    const { Hono } = await import('hono');
    const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
    const app = new Hono();
    app.use('*', async (c, next) => { c.set('founder', { id: OWNER, email: 'dh@example.com' }); await next(); });
    app.route('/', letterRoutes as never);
    const body = await (await app.request('/autopilot')).text();

    // Controls express intent and limits. A text input here would mean the
    // owner types the boundary of Foundry's authority over its own repository.
    const form = /<form[^>]*action="\/autopilot\/development\/grant"[\s\S]*?<\/form>/.exec(body);
    expect(form, 'the grant form is gone').not.toBeNull();
    expect(/type="text"|<textarea|<select/.test(form![0]),
      'the scope must come from the module that declared it, not from a form').toBe(false);
  });
});
