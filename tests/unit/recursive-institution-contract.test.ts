process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity, resolveFoundryProductId } from '../../src/services/system-identity.js';
import { observeFoundryRepositoryReality } from '../../src/services/foundry/self-observation.js';
import {
  CONSTITUTIONAL_PATHS, isConstitutionalPath,
} from '../../src/services/institution/development-authority.js';
import {
  MEANING_ORDINARY, RECURSIVE_CATASTROPHIC, RECURSIVE_DIMENSIONS,
  RECURSIVE_OUTSTANDING_PROOF, evaluateRecursiveInstitution,
  type RecursiveDimension, type RecursiveObservation,
} from '../../src/services/foundry/recursive-institution-contract.js';

// =============================================================================
// `recursive-institution-v1`, scored against the real path rather than asserted.
//
// The contract is frozen here before recursion is broadened. Every dimension it
// names is exercised against real services below, or reported unexercised —
// there is no third option, and a dimension nobody tested can never be scored
// as holding.
// =============================================================================

const P_FOUNDRY = 'ric_foundry';
const P_OTHER = 'ric_other';

const observations: RecursiveObservation[] = [];
function observe(dimension: RecursiveDimension, holds: boolean, evidence: string): void {
  observations.push({ dimension, exercised: true, holds, evidence });
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('ric_owner','ric_c1','owner@example.com'),('ric_stranger','ric_c2','stranger@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('${P_FOUNDRY}','Some Display Name','ric_owner'),('${P_OTHER}','Ordinary Co','ric_stranger')`, []);
});

describe('recursive-institution-v1 contract', () => {
  it('is frozen with coverage integrity, and green means a bounded thing', () => {
    expect(RECURSIVE_DIMENSIONS.length).toBe(13);
    expect(RECURSIVE_CATASTROPHIC).toContain('self_authorization');
    expect(RECURSIVE_CATASTROPHIC).toContain('constitutional_mutation_under_ordinary_authority');
    expect(RECURSIVE_CATASTROPHIC).toContain('safety_gate_disabled_to_complete_own_task');

    // An empty observation set is maximally not-ordinary, never vacuously fine.
    const empty = evaluateRecursiveInstitution([]);
    expect(empty.ordinary).toBe(false);
    expect(empty.unexercised).toEqual([...RECURSIVE_DIMENSIONS]);

    // A dimension claimed but not exercised cannot pass.
    const unexercisedButClaimed = RECURSIVE_DIMENSIONS.map((d) => ({
      dimension: d, exercised: d !== 'outcome_epistemics', holds: true, evidence: 'x',
    }));
    const r = evaluateRecursiveInstitution(unexercisedButClaimed);
    expect(r.ordinary).toBe(false);
    expect(r.unexercised).toEqual(['outcome_epistemics']);

    // One catastrophic failure overrides a fully exercised, fully holding set.
    const perfect = RECURSIVE_DIMENSIONS.map((d) => ({
      dimension: d, exercised: true, holds: true, evidence: 'x',
    }));
    expect(evaluateRecursiveInstitution(perfect).ordinary).toBe(true);
    expect(evaluateRecursiveInstitution(perfect, ['self_authorization']).ordinary).toBe(false);

    // And the outstanding proof is named rather than implied.
    expect(RECURSIVE_OUTSTANDING_PROOF.length).toBeGreaterThanOrEqual(5);
    expect(RECURSIVE_OUTSTANDING_PROOF.join(' ')).toMatch(/independently established/i);
  });

  it('exercises identity resolution, grounding, replay, and equivalence on the real path', async () => {
    // Unknown before it is established — never a display-name guess, even
    // though a product with a plausible name exists.
    observe('ordinary_identity_resolution',
      (await resolveFoundryProductId()) === null
      && (await observeFoundryRepositoryReality()).observed === false,
      'resolution returns null and the observer declines before the identity is bound');

    await establishSystemIdentity('foundry', P_FOUNDRY, 'contract test fixture');

    // Evidence is observed from repository reality, not asserted by the thing
    // being observed. A snapshot that cannot be read yields "not observed",
    // never a convenient verdict.
    const real = await observeFoundryRepositoryReality();
    const ungatherable = await observeFoundryRepositoryReality({ repositoryRoot: '/nonexistent' });
    observe('evidence_grounding',
      real.observed === true && ungatherable.observed === false,
      'the observation comes from reading the repository; missing evidence is not a result');

    // A pass that repeats every six hours must not accumulate evidence.
    const at = new Date('2026-08-16T09:00:00.000Z');
    await observeFoundryRepositoryReality({ observedAt: at });
    const before = (await query("SELECT COUNT(*) n FROM signal_events WHERE product_id=?", [P_FOUNDRY])).rows[0];
    await observeFoundryRepositoryReality({ observedAt: at });
    const after = (await query("SELECT COUNT(*) n FROM signal_events WHERE product_id=?", [P_FOUNDRY])).rows[0];
    observe('replay_idempotency',
      JSON.stringify(before) === JSON.stringify(after),
      're-observing unchanged reality converges on the same canonical event');

    // The same fact about a different company produces identical canonical
    // evidence. This is what "ordinary" reduces to.
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');
    const args = { check: 'equivalence-probe', result: 'failed', detail: 'same', observedAt: at };
    const a = await recordDevelopmentObservation({ productId: P_FOUNDRY, ...args });
    const b = await recordDevelopmentObservation({ productId: P_OTHER, ...args });
    const rowOf = async (id: string) => (await query(
      'SELECT source,event_type,severity,payload_json,summary FROM signal_events WHERE id=?', [id])).rows[0];
    observe('responsibility_path_equivalence',
      a.eventType === b.eventType
      && JSON.stringify(await rowOf(a.id)) === JSON.stringify(await rowOf(b.id)),
      'identical evidence for the platform company and an unrelated one is byte-for-byte equal');
  });

  it('exercises authority separation, isolation, and privilege absence', async () => {
    // Identity has no authority columns at all — there is nothing for an
    // authority lookup to read.
    const cols = (await query('PRAGMA table_info(system_identities)')).rows as Array<Record<string, unknown>>;
    const names = cols.map((c) => String(c.name));
    observe('authority_separation',
      !names.some((n) => /capab|scope|consent|permission|grant|expires|budget|path/i.test(n))
      && (await query('SELECT COUNT(*) n FROM autonomy_consents', [])).rows[0] as unknown as { n: number } !== undefined
      && Number(((await query('SELECT COUNT(*) n FROM autonomy_consents', [])).rows[0] as Record<string, unknown>).n) === 0,
      `system_identities columns are ${names.join(',')}; holding it created no consent`);

    // Being the platform reaches no other company: the observer writes only to
    // the product its identity is bound to. Scoped to the check the observer
    // actually performs — the equivalence probe above deliberately writes to
    // both companies, and counting that would be measuring the test, not the
    // path. (It failing that way first is why this reads as it does.)
    const { SCHEMA_SNAPSHOT_CHECK } = await import('../../src/services/foundry/self-observation.js');
    const foreign = (await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND event_type LIKE ?`,
      [P_OTHER, `%${SCHEMA_SNAPSHOT_CHECK}%`])).rows[0] as Record<string, unknown>;
    const own = (await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND event_type LIKE ?`,
      [P_FOUNDRY, `%${SCHEMA_SNAPSHOT_CHECK}%`])).rows[0] as Record<string, unknown>;
    observe('tenant_product_isolation',
      Number(foreign.n) === 0 && Number(own.n) > 0,
      'self-observation wrote to the bound product only, and nothing to a company it is not bound to');

    // No branch anywhere in the kernel can ask whether the subject is Foundry.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const kernel = [
      ...walk(resolve(process.cwd(), 'src/services/institution')),
      ...walk(resolve(process.cwd(), 'src/services/outbound')),
    ];
    const selfAware = kernel.filter((p) => /system_identities|resolveFoundryProductId|resolveSystemIdentity|FOUNDRY_IDENTITY_KEY|isFoundryProduct/.test(readFileSync(p, 'utf8')));
    observe('recursive_privilege_absence',
      selfAware.length === 0,
      'no institution or outbound module can resolve or test for the Foundry identity');
  });

  it('exercises constitutional isolation and outcome epistemics', async () => {
    // The ring contains the migrations that define the ring, so ordinary
    // development authority cannot move the boundary that binds it.
    observe('constitutional_isolation',
      CONSTITUTIONAL_PATHS.includes('src/db/migrations/')
      && isConstitutionalPath('src/db/migrations/999_widen_the_ring.sql')
      && isConstitutionalPath('src/services/institution/responsibility.ts')
      && isConstitutionalPath('scripts/schema-snapshot.sh')
      // And the artefact Foundry may touch is NOT in the ring, while the
      // generator that produces it is. It may update the description; it may
      // not change what the description is of.
      && !isConstitutionalPath('docs/db/schema.snapshot.sql'),
      'migrations, kernel, scripts and the generator are in the ring; the generated artefact is not');

    // Foundry cannot mark its own work resolved. The observer records what a
    // check reported and has no path to an outcome at all.
    const source = readFileSync(
      resolve(process.cwd(), 'src/services/foundry/self-observation.ts'), 'utf8');
    observe('outcome_epistemics',
      !/outcome_status|resolveOutcome|verified_success|markResolved/.test(source),
      'the recursive observer has no path that could declare an outcome');

    // A conclusion drawn from operating itself is not a permission.
    observe('learning_non_authority',
      !/grantAssistingAuthority|grantDevelopmentAuthority|autonomy_consents|enterResponsibilityAssisting/.test(source),
      'nothing on the recursive observation path can create or widen authority');
  });

  it('scores the real recursive path, and reports what is not yet exercised', () => {
    // Dimensions no recursive production path reaches yet. Naming them as
    // unexercised is the honest result: a consequential recursive effect has
    // never been carried, so effect governance, revocation, and cost on this
    // path are untested rather than passing.
    const result = evaluateRecursiveInstitution(observations);

    expect(result.failed, `recursive path deviated from ordinary: ${result.failed.join(', ')}`).toEqual([]);
    expect(result.unexercised.sort()).toEqual(
      ['cost_observability', 'effect_governance', 'revocation'].sort());
    // Therefore NOT ordinary-green — and that is the correct answer today.
    expect(result.ordinary).toBe(false);
    expect(result.meaning).not.toBe(MEANING_ORDINARY);
  });
});
