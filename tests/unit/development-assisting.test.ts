process.env.TURSO_DATABASE_URL = 'file::memory:';

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';
import { recordDevelopmentObservation } from '../../src/services/institution/development-observation.js';
import {
  grantDevelopmentAuthority, revokeDevelopmentAuthority,
} from '../../src/services/institution/development-authority.js';
import {
  enterDevelopmentAssisting, executeDevelopmentChange, planDevelopmentChange,
  recordDevelopmentOutcome, rollbackDevelopmentChange, verifyDevelopmentChange,
} from '../../src/services/institution/development-assisting.js';

const CHECK = 'schema-snapshot-freshness';
const REPO = 'Thmsnrtn/foundry';
const TARGET = 'docs/db/schema.snapshot.sql';
/** Distinct intended content per product, so no two fixtures share a change. */
const contentFor = (productId: string) => `-- regenerated for ${productId}\n`;
const NEW_CONTENT = contentFor('as_main');

const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Keep the committed schema snapshot in sync with the migrations'],
  ['desired_outcome', 'A migration and its snapshot always land together'],
  ['success_conditions', 'Regenerating the snapshot produces no diff'],
  ['operating_constraints', 'Generated artefact only; never hand-edited'],
  ['dependencies', 'The migration runner and the snapshot generator'],
  ['risks', 'A stale snapshot hides schema drift'],
  ['systems', 'src/db/migrations and docs/db/schema.snapshot.sql'],
  ['failure_modes', 'Snapshot not regenerated after a migration is added'],
];

let root: string;

/** Drives one product all the way from evidence to Assisting through ordinary mechanisms. */
async function seedAssisting(productId: string, prefix: string, ownerId: string): Promise<{
  responsibilityId: string; consentId: string;
}> {
  const responsibilityId = `${prefix}_resp`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','medium','{}','Snapshot drifted')`, [`${prefix}_sig`, productId]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,'Keep the schema snapshot in sync','development','visible')`, [responsibilityId, productId]);
  for (const [predicate, value] of UNDERSTANDING) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate, value, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'observed repository reality', observedAt: new Date(),
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);

  const expectationClaimId = await recordReconstructionClaim({
    productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_expectation',
    value: { check: CHECK, expected: 'failed' }, epistemicStatus: 'inferred', confidence: 0.8,
    evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'bounded expectation', observedAt: new Date(),
  });
  const { expectationId } = await beginDevelopmentShadowing({
    productId, responsibilityId, expectedCheck: CHECK, expectedResult: 'failed',
    expectationClaimId, observationSourceSignalId: `${prefix}_sig`,
  });
  // The Shadowing phase happens before any change: state the expectation, then
  // observe. Both belong strictly earlier than anything this change produces.
  await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
    [expectationId]);
  await recordDevelopmentObservation({
    productId, check: CHECK, result: 'failed', detail: 'snapshot omits a table the code references',
    observedAt: new Date(Date.now() - 30_000),
  });
  const shadow = await resolveDevelopmentShadowing({ productId, expectationId });
  expect(shadow.verdict).toBe('matched');
  const comparisonId = String(((await query(
    'SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?', [expectationId],
  )).rows[0] as Record<string, unknown>).id);

  // The institution's own grounded evidence for what should change. The plan
  // is derived from this, not handed in by the caller.
  for (const [predicate, value] of [
    ['development_need', { check: CHECK, summary: 'snapshot drifted from migrations' }],
    ['development_intended_content', { path: TARGET, content: contentFor(productId), changeClass: 'generated_artifact' }],
  ] as Array<[string, unknown]>) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate, value, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'deterministic development disposition input', observedAt: new Date(),
    });
  }

  const consentId = await grantDevelopmentAuthority({
    productId, responsibilityId, ownerId, repository: REPO, allowedPathPrefixes: ['docs/db/'],
    changeClass: 'generated_artifact', requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
  });
  await enterDevelopmentAssisting({ productId, responsibilityId, shadowComparisonId: comparisonId, authorityConsentId: consentId });
  return { responsibilityId, consentId };
}

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-assist-'));
  mkdirSync(join(dir, 'docs/db'), { recursive: true });
  writeFileSync(join(dir, TARGET), '-- stale\n');
  return dir;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('as_owner','as_clerk','as@example.com'),('as_other','as_other_clerk','other@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('as_main','Main Co','as_owner'),('as_revoke','Revoke Co','as_owner'),
    ('as_scope','Scope Co','as_owner'),('as_replay','Replay Co','as_owner'),
    ('as_sub','Substitution Co','as_owner'),('as_foreign','Foreign Co','as_other')`, []);
  root = freshRepo();
});

describe('first bounded development Assisting vertical', () => {
  it('carries evidence → responsibility → Shadowing → authority → Assisting → change → verification → outcome', async () => {
    const { responsibilityId } = await seedAssisting('as_main', 'as', 'as_owner');
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='as_resp'", [])).rows[0])
      .toMatchObject({ state: 'assisting' });

    const plan = await planDevelopmentChange({ productId: 'as_main', responsibilityId, repository: REPO });
    expect(plan.status).toBe('planned');
    // Foundry selected both the target and the content from its own evidence.
    expect(plan).toMatchObject({ targetPath: TARGET, intendedContent: NEW_CONTENT });
    // A plan is not an execution.
    expect(readFileSync(join(root, TARGET), 'utf8')).toBe('-- stale\n');

    const { plan: executed, receipt } = await executeDevelopmentChange({
      productId: 'as_main', planId: plan.id, repositoryRoot: root, content: NEW_CONTENT,
    });
    expect(executed.status).toBe('applied');
    expect(readFileSync(join(root, TARGET), 'utf8')).toBe(NEW_CONTENT);

    // An execution is not a verification: before any check ran, nothing passed.
    const early = await verifyDevelopmentChange({
      productId: 'as_main', planId: plan.id, repositoryRoot: root, expectedContent: NEW_CONTENT,
    });
    expect(early).toMatchObject({ diffVerified: true, verificationStatus: 'unresolved' });
    expect((await recordDevelopmentOutcome({ productId: 'as_main', planId: plan.id })).outcomeStatus)
      .toBe('unresolved');

    // The check runs after the change, as it must to be verifying it.
    await recordDevelopmentObservation({
      productId: 'as_main', check: CHECK, result: 'passed', detail: 'snapshot regenerated, no diff',
      observedAt: new Date(Date.now() + 10_000),
    });
    const verified = await verifyDevelopmentChange({
      productId: 'as_main', planId: plan.id, repositoryRoot: root, expectedContent: NEW_CONTENT,
    });
    expect(verified).toMatchObject({ diffVerified: true, verificationStatus: 'passed' });

    const outcome = await recordDevelopmentOutcome({ productId: 'as_main', planId: plan.id });
    expect(outcome.outcomeStatus).toBe('verified_success');
    expect(outcome.learnedClaimId).toBeTruthy();

    // Learning is not authority, and success is not promotion.
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='as_resp'", [])).rows[0])
      .toMatchObject({ state: 'assisting' });
    expect((await query("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='as_main'", [])).rows[0])
      .toMatchObject({ n: 1 });

    // And it is reversible by a recorded, exercised path.
    expect(await rollbackDevelopmentChange({ productId: 'as_main', planId: plan.id, repositoryRoot: root, receipt: receipt! })).toBe(true);
    expect(readFileSync(join(root, TARGET), 'utf8')).toBe('-- stale\n');
    // No verified success survives a reversal, but what was learned does.
    expect((await query('SELECT status,outcome_status,learned_claim_id FROM development_change_plans WHERE id=?', [plan.id])).rows[0])
      .toMatchObject({ status: 'rolled_back', outcome_status: 'unresolved', learned_claim_id: outcome.learnedClaimId });
  });

  it('produces one mutation under replay and concurrent execution', async () => {
    const repo = freshRepo();
    const { responsibilityId } = await seedAssisting('as_replay', 'rpl', 'as_owner');
    const first = await planDevelopmentChange({ productId: 'as_replay', responsibilityId, repository: REPO });
    const replayed = await planDevelopmentChange({ productId: 'as_replay', responsibilityId, repository: REPO });
    expect(replayed.id).toBe(first.id);
    expect((await query("SELECT COUNT(*) n FROM development_change_plans WHERE product_id='as_replay' AND change_id=?",
      [first.changeId])).rows[0]).toMatchObject({ n: 1 });

    const results = await Promise.all([1, 2, 3, 4].map(() => executeDevelopmentChange({
      productId: 'as_replay', planId: first.id, repositoryRoot: repo, content: contentFor('as_replay'),
    })));
    expect(results.filter((r) => r.receipt !== null)).toHaveLength(1);
    expect(readFileSync(join(repo, TARGET), 'utf8')).toBe(contentFor('as_replay'));
  });

  it('performs zero mutation when authority is revoked between plan and execution', async () => {
    const repo = freshRepo();
    const { responsibilityId, consentId } = await seedAssisting('as_revoke', 'rev', 'as_owner');
    const plan = await planDevelopmentChange({ productId: 'as_revoke', responsibilityId, repository: REPO });

    await revokeDevelopmentAuthority('as_revoke', consentId, 'as_owner');

    const { plan: refused, receipt } = await executeDevelopmentChange({
      productId: 'as_revoke', planId: plan.id, repositoryRoot: repo, content: contentFor('as_revoke'),
    });
    expect(refused).toMatchObject({ status: 'refused', refusedReason: 'authority_absent' });
    expect(receipt).toBeNull();
    expect(readFileSync(join(repo, TARGET), 'utf8')).toBe('-- stale\n');
  });

  it('performs zero mutation when authority has expired between plan and execution', async () => {
    const repo = freshRepo();
    const { responsibilityId, consentId } = await seedAssisting('as_scope', 'sco', 'as_owner');
    const plan = await planDevelopmentChange({ productId: 'as_scope', responsibilityId, repository: REPO });
    await query('UPDATE autonomy_consents SET expires_at=? WHERE id=?',
      [new Date(Date.now() - 1000).toISOString(), consentId]);

    const { plan: refused } = await executeDevelopmentChange({
      productId: 'as_scope', planId: plan.id, repositoryRoot: repo, content: contentFor('as_scope'),
    });
    expect(refused).toMatchObject({ status: 'refused', refusedReason: 'authority_absent' });
    expect(readFileSync(join(repo, TARGET), 'utf8')).toBe('-- stale\n');
  });

  it('refuses substituted content after the plan was authorized, before writing anything', async () => {
    const repo = freshRepo();
    const { responsibilityId } = await seedAssisting('as_sub', 'sub', 'as_owner');
    const plan = await planDevelopmentChange({ productId: 'as_sub', responsibilityId, repository: REPO });
    const { plan: refused, receipt } = await executeDevelopmentChange({
      productId: 'as_sub', planId: plan.id, repositoryRoot: repo, content: '-- something else entirely\n',
    });
    expect(refused).toMatchObject({ status: 'refused', refusedReason: 'content_does_not_match_plan' });
    expect(receipt).toBeNull();
    expect(readFileSync(join(repo, TARGET), 'utf8')).toBe('-- stale\n');
  });

  it("refuses to plan its own proposal when the proposal falls outside authority", async () => {
    // Foundry selecting the change does not mean Foundry may make it. Each
    // case grounds a real intended change that authority does not permit.
    const cases: Array<[string, unknown, RegExp]> = [
      ['osp_src', { path: 'src/index.ts', content: 'x\n', changeClass: 'generated_artifact' }, /path not authorized/],
      ['osp_ring', { path: 'src/db/migrations/999.sql', content: 'x\n', changeClass: 'generated_artifact' }, /path not authorized/],
      ['osp_agents', { path: 'AGENTS.md', content: 'x\n', changeClass: 'generated_artifact' }, /path not authorized/],
      ['osp_escape', { path: '../elsewhere/x.sql', content: 'x\n', changeClass: 'generated_artifact' }, /path not authorized/],
      ['osp_class', { path: TARGET, content: 'x\n', changeClass: 'documentation' }, /change class not authorized/],
    ];
    for (const [productId, intended, expected] of cases) {
      await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [productId, productId, 'as_owner']);
      const { responsibilityId } = await seedAssisting(productId, productId, 'as_owner');
      // Replace the in-scope proposal with the out-of-scope one under test.
      await query(`UPDATE reconstruction_claims SET value_json=? WHERE product_id=?
        AND subject=? AND predicate='development_intended_content'`,
      [JSON.stringify(intended), productId, `responsibility:${responsibilityId}`]);

      await expect(planDevelopmentChange({ productId, responsibilityId, repository: REPO })).rejects.toThrow(expected);
      expect((await query('SELECT COUNT(*) n FROM development_change_plans WHERE product_id=?', [productId])).rows[0])
        .toMatchObject({ n: 0 });
    }
    // A foreign repository is refused even for an otherwise valid proposal.
    await expect(planDevelopmentChange({ productId: 'as_main', responsibilityId: 'as_resp', repository: 'someone/else' }))
      .rejects.toThrow(/repository not authorized/);
  });

  it('refuses a plan for a foreign tenant responsibility and never crosses repositories', async () => {
    await seedAssisting('as_foreign', 'fgn', 'as_other');
    // The foreign responsibility's evidence is simply invisible in this
    // product, so Foundry has nothing to act on rather than acting wrongly.
    await expect(planDevelopmentChange({ productId: 'as_main', responsibilityId: 'fgn_resp', repository: REPO }))
      .rejects.toThrow(/disposition is do_nothing/);
    await expect(executeDevelopmentChange({
      productId: 'as_foreign', planId: 'nonexistent', repositoryRoot: root, content: 'x\n',
    })).rejects.toThrow(/refused/);
    expect((await query("SELECT COUNT(*) n FROM development_change_plans WHERE product_id='as_foreign'", [])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('cannot record a verified success without both independent verification and matching bytes', async () => {
    const plan = (await query("SELECT id FROM development_change_plans WHERE product_id='as_main' LIMIT 1", []))
      .rows[0] as Record<string, unknown>;
    // Passing checks alone are not a verified outcome.
    await expect(query(
      "UPDATE development_change_plans SET outcome_status='verified_success',verification_status='passed',diff_verified=0 WHERE id=?",
      [String(plan.id)],
    )).rejects.toThrow(/outcome_unsupported/);
    // Nor are matching bytes with no independent check.
    await expect(query(
      "UPDATE development_change_plans SET outcome_status='verified_success',verification_status='unresolved',diff_verified=1 WHERE id=?",
      [String(plan.id)],
    )).rejects.toThrow(/outcome_unsupported/);
  });

  it('cannot rewrite what was authorized once a plan exists', async () => {
    const plan = (await query("SELECT id FROM development_change_plans WHERE product_id='as_main' LIMIT 1", []))
      .rows[0] as Record<string, unknown>;
    for (const mutation of [
      "target_path='src/index.ts'", "change_class='documentation'", "content_digest='forged'",
      "repository_ref='someone/else'", "responsibility_id='fgn_resp'",
    ]) {
      await expect(query(`UPDATE development_change_plans SET ${mutation} WHERE id=?`, [String(plan.id)]))
        .rejects.toThrow(/binding_immutable/);
    }
  });

  it('refuses a plan written directly against a non-Assisting or unauthorized binding', async () => {
    // Even with a well-formed row, the database refuses a plan that is not
    // bound to an Assisting development responsibility holding that consent.
    const grounding = JSON.stringify([String(((await query(
      "SELECT id FROM reconstruction_claims WHERE product_id='as_main' AND predicate='development_need'", [],
    )).rows[0] as Record<string, unknown>).id)]);
    await expect(query(
      `INSERT INTO development_change_plans
       (id,product_id,responsibility_id,authority_consent_id,change_id,repository_ref,target_path,change_class,
        content_digest,disposition,disposition_evidence_json)
       SELECT 'forged','as_main','as_resp',a.id,'chg_forged',?,?,'generated_artifact','d','change',?
       FROM autonomy_consents a WHERE a.product_id='as_revoke' LIMIT 1`, [REPO, TARGET, grounding],
    )).rejects.toThrow(/binding_invalid/);

    // And a plan that never passed the disposition gate is refused outright.
    await expect(query(
      `INSERT INTO development_change_plans
       (id,product_id,responsibility_id,authority_consent_id,change_id,repository_ref,target_path,change_class,
        content_digest,disposition,disposition_evidence_json)
       SELECT 'nogate','as_main','as_resp',a.id,'chg_nogate',?,?,'generated_artifact','d','investigate',?
       FROM autonomy_consents a WHERE a.product_id='as_main' LIMIT 1`, [REPO, TARGET, grounding],
    )).rejects.toThrow(/disposition_invalid/);
    expect(existsSync(join(root, 'src'))).toBe(false);
  });
});

describe('what the founder is told about development', () => {
  it('always states what Foundry may change, and reports only material changes', async () => {
    const { getFounderDevelopmentActivity } = await import('../../src/services/institution/development-assisting.js');
    const activity = await getFounderDevelopmentActivity('as_main');

    // Authority is shown in plain language even when nothing happened, because
    // permission is not something a founder should discover after the fact.
    expect(activity.permitted).toEqual([expect.objectContaining({
      what: 'regenerate files that are built from your other files',
      where: ['docs/db/'],
    })]);
    // No internal machinery leaks into founder-facing copy.
    const rendered = JSON.stringify(activity);
    for (const term of ['migration', 'epistemic', 'E3', 'assisting', 'consent_id', 'change_id']) {
      expect(rendered.toLowerCase()).not.toContain(term.toLowerCase());
    }

    // A withdrawn grant stops being advertised.
    const withdrawn = await getFounderDevelopmentActivity('as_revoke');
    expect(withdrawn.permitted).toEqual([]);
    expect(withdrawn.changes.some((c) => /did not make this change/.test(c.detail))).toBe(true);

    // A change that was made and then undone says exactly that.
    expect(activity.changes.some((c) => /made this change and then undid it/.test(c.detail))).toBe(true);
  });
});
