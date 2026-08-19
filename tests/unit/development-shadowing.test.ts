process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  developmentEventType, recordDevelopmentObservation,
} from '../../src/services/institution/development-observation.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';

// ─── The first development responsibility ────────────────────────────────────
// Chosen from a real, verified repository need rather than invented to
// demonstrate autonomy: the committed schema snapshot silently drifted from the
// migrations and only failed once a new table happened to be referenced.
// It is narrow (one generated artefact), reversible (regenerate and commit),
// low consequence (a development-time check with no customer-reaching effect),
// independently testable (add a migration, observe the check), not
// security-sensitive, not constitutional, and depends on no external service.
const CHECK = 'schema-snapshot-freshness';

/** The eight facts the development capability shape requires to be Understood. */
const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Keep the committed schema snapshot in sync with the migrations'],
  ['desired_outcome', 'A migration and its snapshot always land together'],
  ['success_conditions', 'Regenerating the snapshot produces no diff'],
  ['operating_constraints', 'Generated artefact only; never hand-edited'],
  ['dependencies', 'The migration runner and the snapshot generator'],
  ['risks', 'A stale snapshot hides schema drift until an unrelated check fails'],
  ['systems', 'src/db/migrations and docs/db/schema.snapshot.sql'],
  ['failure_modes', 'Snapshot not regenerated after a migration is added'],
];

async function seedDevelopmentResponsibility(productId: string, prefix: string): Promise<string> {
  const responsibilityId = `${prefix}_resp`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','medium','{}','Schema snapshot drifted from migrations')`,
  [`${prefix}_sig`, productId]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,'Keep the schema snapshot in sync with migrations','development','visible')`,
  [responsibilityId, productId]);
  for (const [predicate, value] of UNDERSTANDING) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate, value,
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'observed repository reality', observedAt: new Date(),
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);
  return responsibilityId;
}

/** A grounding claim for what Foundry expects the check to report. */
async function expectationClaim(productId: string, prefix: string, expected: string): Promise<string> {
  return recordReconstructionClaim({
    productId, subject: `responsibility:${prefix}_resp`, predicate: 'development_expectation',
    value: { check: CHECK, expected }, epistemicStatus: 'inferred', confidence: 0.8,
    evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'bounded expectation from observed repository reality', observedAt: new Date(),
  });
}

/**
 * Represents time passing between Foundry stating an expectation and the
 * development work being done, so every observation genuinely follows the
 * prediction it tests.
 */
async function elapseSinceExpectation(expectationId: string, seconds: number): Promise<void> {
  await query(
    "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,?) WHERE id=?",
    [`-${seconds} seconds`, expectationId],
  );
}

const executionCounts = async (productId: string) => ({
  consents: (await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [productId])).rows[0],
  actions: (await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [productId])).rows[0],
  executions: (await query('SELECT COUNT(*) n FROM action_executions', [])).rows[0],
});

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('dev_owner','dev_clerk','dev@example.com'),('dev_other','dev_other_clerk','other@example.com')`, []);
  // One product per scenario: shared development reality between unrelated
  // expectations would make each verdict depend on test ordering.
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('dev_product','Owned Co','dev_owner'),('dev_conflict','Conflict Co','dev_owner'),
    ('dev_expired','Expiry Co','dev_owner'),('dev_foreign','Foreign Co','dev_other')`, []);
});

describe('development as an ordinary shadowed responsibility', () => {
  it('reaches Understood through the ordinary development capability shape and enters Shadowing with no authority', async () => {
    const before = await executionCounts('dev_product');
    const responsibilityId = await seedDevelopmentResponsibility('dev_product', 'dev');
    const claimId = await expectationClaim('dev_product', 'dev', 'failed');

    const { responsibility, expectationId, expectedEventType } = await beginDevelopmentShadowing({
      productId: 'dev_product', responsibilityId, expectedCheck: CHECK, expectedResult: 'failed',
      expectationClaimId: claimId, observationSourceSignalId: 'dev_sig',
    });
    await elapseSinceExpectation(expectationId, 10);

    expect(responsibility).toMatchObject({ state: 'shadowing', authorityRef: null });
    expect(expectedEventType).toBe(developmentEventType(CHECK, 'failed'));
    expect(expectationId).toBeTruthy();
    // Watching is not carrying: nothing executable was created.
    expect(await executionCounts('dev_product')).toEqual(before);
  });

  it('matches an independently recorded result the observer produced without seeing the expectation', async () => {
    const expectation = await query(
      "SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id='dev_resp'", [],
    );
    const expectationId = String((expectation.rows[0] as Record<string, unknown>).id);

    const observation = await recordDevelopmentObservation({
      productId: 'dev_product', check: CHECK, result: 'failed',
      detail: 'Referenced tables not in docs/db/schema.snapshot.sql: institutional_judgment_evaluations',
    });

    const verdict = await resolveDevelopmentShadowing({ productId: 'dev_product', expectationId });
    expect(verdict.verdict).toBe('matched');
    expect(verdict.comparisons).toEqual([
      { observationId: observation.id, eventType: developmentEventType(CHECK, 'failed'), classification: 'matched' },
    ]);
    expect(verdict.learnedClaimId).toBeTruthy();

    // Learning grants nothing and does not move the responsibility.
    expect((await query("SELECT state,authority_ref FROM institutional_responsibilities WHERE id='dev_resp'", [])).rows[0])
      .toMatchObject({ state: 'shadowing', authority_ref: null });
  });

  it('converges on replay rather than inflating the evidence', async () => {
    const expectationId = String(((await query(
      "SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id='dev_resp'", [],
    )).rows[0] as Record<string, unknown>).id);

    const first = await resolveDevelopmentShadowing({ productId: 'dev_product', expectationId });
    const second = await resolveDevelopmentShadowing({ productId: 'dev_product', expectationId });
    expect(second.comparisons).toEqual(first.comparisons);
    expect((await query(
      'SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE expectation_id=?', [expectationId],
    )).rows[0]).toMatchObject({ n: 1 });
  });

  it('lets a deviating observation dominate a matching one in the same window', async () => {
    const responsibilityId = await seedDevelopmentResponsibility('dev_conflict', 'devd');
    const claimId = await expectationClaim('dev_conflict', 'devd', 'passed');
    const { expectationId } = await beginDevelopmentShadowing({
      productId: 'dev_conflict', responsibilityId, expectedCheck: CHECK, expectedResult: 'passed',
      expectationClaimId: claimId, observationSourceSignalId: 'devd_sig',
    });
    await elapseSinceExpectation(expectationId, 10);

    await recordDevelopmentObservation({
      productId: 'dev_conflict', check: CHECK, result: 'passed', detail: 'snapshot regenerated, no diff',
    });
    // The second run of the same check reported something else entirely.
    await recordDevelopmentObservation({
      productId: 'dev_conflict', check: CHECK, result: 'failed', detail: 'a later migration landed without a snapshot',
    });

    const verdict = await resolveDevelopmentShadowing({ productId: 'dev_conflict', expectationId });
    expect(verdict.comparisons.map((c) => c.classification).sort()).toEqual(['deviated', 'matched']);
    expect(verdict.verdict).toBe('deviated');
    // A conflict is preserved as a conflict rather than averaged into a pass.
    expect((await query('SELECT epistemic_status FROM reconstruction_claims WHERE id=?', [verdict.learnedClaimId!])).rows[0])
      .toMatchObject({ epistemic_status: 'conflicting' });
  });

  it('leaves an expired expectation unresolved instead of resolving it late', async () => {
    const responsibilityId = await seedDevelopmentResponsibility('dev_expired', 'devx');
    const claimId = await expectationClaim('dev_expired', 'devx', 'passed');
    const { expectationId } = await beginDevelopmentShadowing({
      productId: 'dev_expired', responsibilityId, expectedCheck: CHECK, expectedResult: 'passed',
      expectationClaimId: claimId, observationSourceSignalId: 'devx_sig',
    });

    // Wind the expectation into a window that has already closed.
    const opened = new Date(Date.now() - 60_000).toISOString();
    const closed = new Date(Date.now() - 30_000).toISOString();
    await query('UPDATE responsibility_shadow_expectations SET created_at=?,valid_until=? WHERE id=?',
      [opened, closed, expectationId]);
    await recordDevelopmentObservation({
      productId: 'dev_expired', check: CHECK, result: 'passed', detail: 'reported inside the closed window',
      observedAt: new Date(Date.now() - 45_000),
    });

    const verdict = await resolveDevelopmentShadowing({ productId: 'dev_expired', expectationId });
    expect(verdict.comparisons.map((c) => c.classification)).toEqual(['unresolved']);
    expect(verdict.verdict).toBe('unresolved');
  });

  it('refuses fabricated, circular, and empty verification', async () => {
    const expectationId = String(((await query(
      "SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id='dev_resp'", [],
    )).rows[0] as Record<string, unknown>).id);

    // A self-authored signal cannot satisfy a development expectation, however
    // convincingly it is named.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('dev_forged','dev_product','manual',?,'low','{}','Self-authored pass')`,
    [developmentEventType(CHECK, 'failed')]);
    await expect(query(
      `INSERT INTO responsibility_shadow_comparisons (id,expectation_id,product_id,observation_ref,classification)
       VALUES ('dev_forged_cmp',?,'dev_product','signal_event:dev_forged','matched')`, [expectationId],
    )).rejects.toThrow(/observation_not_independent/);

    // An observer that can cite the expectation is not an independent observer.
    for (const circular of [
      { expectation_id: expectationId }, { expected_event_type: developmentEventType(CHECK, 'failed') },
      { responsibility_id: 'dev_resp' },
    ]) {
      await expect(query(
        `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
         VALUES (?,'dev_product','development_verification','development_verified:x:passed','low',?,'Circular')`,
        [`circ_${Object.keys(circular)[0]}`, JSON.stringify({ check: CHECK, result: 'passed', ...circular })],
      )).rejects.toThrow(/circular_grounding/);
    }

    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('dev_empty','dev_product','development_verification','development_verified::','low','{"check":"","result":""}','Empty')`, [],
    )).rejects.toThrow(/payload_invalid/);
    await expect(recordDevelopmentObservation({
      productId: 'dev_product', check: '  ', result: 'passed', detail: 'no check',
    })).rejects.toThrow(/refused/);
  });

  it('never resolves one tenant expectation with another tenant development reality', async () => {
    const responsibilityId = await seedDevelopmentResponsibility('dev_foreign', 'devf');
    const claimId = await expectationClaim('dev_foreign', 'devf', 'passed');
    const { expectationId } = await beginDevelopmentShadowing({
      productId: 'dev_foreign', responsibilityId, expectedCheck: CHECK, expectedResult: 'passed',
      expectationClaimId: claimId, observationSourceSignalId: 'devf_sig',
    });
    await elapseSinceExpectation(expectationId, 10);

    await recordDevelopmentObservation({
      productId: 'dev_product', check: CHECK, result: 'passed', detail: 'another tenant repository',
    });

    // Resolving under the wrong tenant is refused outright, and the foreign
    // expectation sees none of the owned product's observations.
    await expect(resolveDevelopmentShadowing({ productId: 'dev_product', expectationId }))
      .rejects.toThrow(/refused/);
    expect((await resolveDevelopmentShadowing({ productId: 'dev_foreign', expectationId })).comparisons).toEqual([]);
  });

  it('never promotes itself out of Shadowing', async () => {
    const states = await query(
      "SELECT DISTINCT state FROM institutional_responsibilities WHERE capability='development'", [],
    );
    expect(states.rows.map((r) => r.state).sort()).toEqual(['shadowing']);
    expect((await query(
      "SELECT COUNT(*) n FROM autonomy_consents WHERE product_id IN ('dev_product','dev_foreign')", [],
    )).rows[0]).toMatchObject({ n: 0 });
  });

  it('lets the owner open a development expectation, and refuses a silent check', async () => {
    // The reason `development-shadowing.ts` was DARK: nothing in production
    // OPENED an expectation, so independent check results arrived with nothing
    // to resolve. Foundry predicting on its own behalf would have been
    // manufacturing the prediction to fit the evidence — so the owner states
    // it, as a bounded choice among checks that already report.
    const { availableDevelopmentChecks, beginFounderDevelopmentShadowing } = await import(
      '../../src/services/institution/development-shadowing.js');
    const { recordDevelopmentObservation } = await import(
      '../../src/services/institution/development-observation.js');

    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('fds_sig','dev_product','repository','development_need_observed','low','{}','seed')`, []);
    await query(`INSERT INTO institutional_responsibilities
      (id,product_id,title,capability,state,discovery_evidence_ref)
      VALUES ('fds_resp','dev_product','Keep the snapshot consistent','development','understood','signal_event:fds_sig')`, []);

    // A check nothing reports cannot be watched: entering the rung would be a
    // promise that observation will arrive rather than proof that it does.
    expect(await availableDevelopmentChecks('dev_product')).not.toContain('never-runs');
    expect(await beginFounderDevelopmentShadowing({
      productId: 'dev_product', responsibilityId: 'fds_resp', founderId: 'dev_owner',
      check: 'never-runs', expectedResult: 'passed',
    })).toBeNull();

    await recordDevelopmentObservation({
      productId: 'dev_product', check: 'fds-check', result: 'passed', detail: 'ran' });
    expect(await availableDevelopmentChecks('dev_product')).toContain('fds-check');

    // A stranger cannot open an expectation for this company.
    expect(await beginFounderDevelopmentShadowing({
      productId: 'dev_product', responsibilityId: 'fds_resp', founderId: 'not-the-owner',
      check: 'fds-check', expectedResult: 'passed',
    })).toBeNull();

    const started = await beginFounderDevelopmentShadowing({
      productId: 'dev_product', responsibilityId: 'fds_resp', founderId: 'dev_owner',
      check: 'fds-check', expectedResult: 'passed',
    });
    expect(started).toMatchObject({ state: 'shadowing' });
    // Watching is not permission.
    expect(started!.authorityRef).toBeNull();

    // The expectation is the owner's own statement, recorded with provenance.
    const statement = (await query(
      `SELECT COUNT(*) n FROM signal_events WHERE product_id='dev_product'
        AND event_type='founder_expects_check:fds-check:passed'`, [])).rows[0];
    expect(statement).toMatchObject({ n: 1 });
  });

  it('keeps the verification intake the only writer of development observations', () => {
    // A second writer would make "independently observed" unverifiable: any
    // caller could mint its own passing result. Bounded static ratchet, in the
    // same spirit as the consequential-effects inventory.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
    // Precise about what is forbidden: MINTING a row whose source is
    // `development_verification`. The first version flagged any file that both
    // inserted signal events anywhere and mentioned the source anywhere, which
    // caught the founder-expectation path — a module that only READS those
    // observations to prove a check reports, and writes a founder assertion
    // under a different source entirely.
    //
    // Reading is expected and unrestricted. Widening the rule to co-occurrence
    // would have forced the honest path to work around a ratchet, which is how
    // ratchets get weakened for real.
    const writers = walk(resolve(process.cwd(), 'src'))
      .filter((path) => !path.endsWith('development-observation.ts'))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        // Each INSERT INTO signal_events, up to the end of its statement.
        const statements = [...source.matchAll(
          /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+signal_events[\s\S]{0,600}?(?:`|;)/gi)];
        return statements.some((m) => /development_verification/.test(m[0]));
      });
    expect(writers).toEqual([]);
  });

  it('cannot touch the repository or run a command', () => {
    // Foundry observes development reality; the development environment
    // performs the work. Nothing here can read, write, or execute.
    for (const file of ['development-observation.ts', 'development-shadowing.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/services/institution', file), 'utf8');
      expect(source).not.toMatch(/from\s+'node:fs'|require\(['"]fs['"]\)/);
      expect(source).not.toMatch(/child_process|execSync|spawn\(/);
    }
  });
});

describe('the founder\'s answer is actually compared against reality', () => {
  it('is resolved by the scheduled pass, not only by a test calling it', async () => {
    // THE HALF-BUILT LOOP. The Letter lets a founder open a development
    // expectation — Foundry asks what they would expect a check to report and
    // records their answer — and `resolveDevelopmentShadowing` had no caller
    // outside this file. So the institution asked a person a question and never
    // compared the answer with what the check actually said.
    //
    // Its external-metric twin was resolved by the judgment tick. Both are now
    // resolved in the same loop, deliberately: they are one thing, and having
    // them wired in two places is how one of them came to be wired in none.
    const P = 'dev_tick';
    await query(`INSERT INTO products (id,name,owner_id) VALUES (?,'Ticked Co','dev_owner')`, [P]);
    const responsibilityId = await seedDevelopmentResponsibility(P, 'devtick');
    const { expectationId } = await beginDevelopmentShadowing({
      productId: P, responsibilityId, expectedCheck: CHECK, expectedResult: 'failed',
      expectationClaimId: await expectationClaim(P, 'devtick', 'failed'),
      observationSourceSignalId: 'devtick_sig',
    });
    // The observation must genuinely follow the prediction it tests.
    await elapseSinceExpectation(expectationId, 60);
    await recordDevelopmentObservation({
      productId: P, check: CHECK, result: 'failed', detail: 'an independent check said so',
    });

    // Nothing has compared them yet.
    expect((await query(
      'SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE expectation_id=?',
      [expectationId])).rows[0]).toMatchObject({ n: 0 });

    // Through the REGISTRY, which is what the scheduler runs. Calling an
    // exported helper would prove the helper works and not that anything calls
    // it — the exact gap this test exists to close.
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    await JOB_REGISTRY.institutional_judgment_tick.fn();

    expect((await query(
      'SELECT classification FROM responsibility_shadow_comparisons WHERE expectation_id=?',
      [expectationId])).rows[0],
    'the scheduled pass must close the loop the founder opened')
      .toMatchObject({ classification: 'matched' });
  });
});
