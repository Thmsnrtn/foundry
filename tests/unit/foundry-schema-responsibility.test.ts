process.env.TURSO_DATABASE_URL = 'file::memory:';

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { establishSystemIdentity } from '../../src/services/system-identity.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';
import { recordDevelopmentObservation } from '../../src/services/institution/development-observation.js';
import {
  grantDevelopmentAuthority, isPathWithinAuthority, revokeDevelopmentAuthority,
} from '../../src/services/institution/development-authority.js';
import {
  enterDevelopmentAssisting, executeDevelopmentChange, planDevelopmentChange,
  verifyDevelopmentChange, verifyDiffScope,
} from '../../src/services/institution/development-assisting.js';

// =============================================================================
// The owner named a real Foundry-company responsibility:
//
//   "Keep Foundry's committed canonical database schema snapshot synchronized
//    with the actual migration-defined schema whenever migrations change."
//
// This drives it through the ORDINARY path — the same owner-report entry any
// other company uses, the same ladder, the same bounded grant, the same
// governed effect. Nothing here is recursive except that the product happens to
// be the one bound to the canonical identity, and nothing in the institution
// can tell.
//
// Owner naming is recognition evidence, not authority. The report makes the
// responsibility Visible; every rung after it still costs what it costs, and
// the grant is a separate deliberate act.
// =============================================================================

const P = 'fsr_foundry';
const OWNER = 'fsr_owner';
const REPO = 'Thmsnrtn/foundry';
const SNAPSHOT = 'docs/db/schema.snapshot.sql';
const CHECK = 'schema-snapshot-freshness';

/** What the canonical generator produces. In the real repository this is the
 * output of `scripts/schema-snapshot.sh`; here it is a fixed generated text, so
 * the test asserts the governed carrying of generated content rather than
 * re-testing sqlite. */
const GENERATED = '-- generated\nCREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT);\n';
const STALE = '-- generated\nCREATE TABLE a (id TEXT);\n';

let root: string;
let responsibilityId: string;

/** A throwaway git repository, so the observed diff is real git truth rather
 * than a list the test asserts about itself. */
function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-schema-'));
  mkdirSync(join(dir, 'docs/db'), { recursive: true });
  writeFileSync(join(dir, SNAPSHOT), STALE);
  writeFileSync(join(dir, 'README.md'), 'unrelated\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-qm', 'base'], { cwd: dir });
  return dir;
}

function changedPaths(dir: string): string[] {
  return execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
    .split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','fsr_clerk','owner@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Foundry','${OWNER}')`, []);
  await establishSystemIdentity('foundry', P, 'test fixture for the owner-named responsibility');
  root = freshRepo();
});

describe('the owner-named schema-snapshot responsibility', () => {
  it('becomes Visible through the ordinary owner-report path, and grants nothing', async () => {
    const reported = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'development',
      what: "Keep the committed canonical schema snapshot synchronized with the migration-defined schema",
    });
    expect(reported?.responsibility).toMatchObject({ state: 'visible', capability: 'development' });
    responsibilityId = reported!.responsibility!.id;

    // Naming is recognition evidence. It is not consent, and it is not write
    // access — the owner said what the company must handle, nothing more.
    expect((await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
    expect(reported!.responsibility!.authorityRef).toBeNull();

    // A stranger cannot report an obligation for this company, canonical
    // identity or not.
    expect(await reportCompanyObligation({
      productId: P, founderId: 'nobody', obligationKind: 'development', what: 'anything',
    })).toBeNull();
  });

  it('earns Understanding only from facts about the real responsibility', async () => {
    await expect(earnResponsibilityUnderstanding(P, responsibilityId)).rejects.toThrow(/insufficient/);

    // Grounded in repository truth: the generator, the artefact it writes, what
    // triggers it, what success is, and what it may never touch. No predicate
    // was invented to satisfy the rung — these are the existing fact shapes.
    const evidenceRef = (await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0] as Record<string, unknown>;
    const signalId = String(evidenceRef.d).replace('signal_event:', '');

    for (const [predicate, value] of [
      ['purpose', 'The repository must accurately represent database reality, so schema drift cannot silently mislead developers, tests, or deployment'],
      ['desired_outcome', 'The committed canonical snapshot exactly equals what the migrations produce'],
      ['success_conditions', 'Regenerating with scripts/schema-snapshot.sh produces no difference from the committed snapshot'],
      ['operating_constraints', `Only ${SNAPSHOT} may change; migrations, the generator, and application source may not`],
      ['dependencies', 'scripts/schema-snapshot.sh and the migration files it applies'],
      ['risks', 'A stale snapshot misleads a reader without changing behaviour, and hides real drift'],
      ['systems', 'The migration set, the canonical generator, and the committed generated artefact'],
      ['failure_modes', 'A migration lands and the snapshot is not regenerated; or the generator cannot run'],
    ] as Array<[string, unknown]>) {
      await recordReconstructionClaim({
        productId: P, subject: `responsibility:${responsibilityId}`, predicate, value,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
        derivationMethod: 'observed repository reality', observedAt: new Date(),
      });
    }
    expect(await earnResponsibilityUnderstanding(P, responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });
  });

  it('shadows without mutating anything, and resolves against independent observation', async () => {
    const before = changedPaths(root);
    const signalId = String((((await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0]) as Record<string, unknown>).d).replace('signal_event:', '');

    const expectationClaimId = await recordReconstructionClaim({
      productId: P, subject: `responsibility:${responsibilityId}`, predicate: 'development_expectation',
      value: { check: CHECK, expected: 'failed' }, epistemicStatus: 'inferred', confidence: 0.8,
      evidenceRefs: [{ kind: 'signal_event', id: signalId }],
      derivationMethod: 'the snapshot predates the current migration set', observedAt: new Date(),
    });
    const { expectationId } = await beginDevelopmentShadowing({
      productId: P, responsibilityId, expectedCheck: CHECK, expectedResult: 'failed',
      expectationClaimId, observationSourceSignalId: signalId,
    });

    // The expectation alone resolves nothing — a prediction is not evidence.
    // It reports `unresolved` with no comparisons rather than erroring, because
    // an absence of observation is a state, not a fault.
    const premature = await resolveDevelopmentShadowing({ productId: P, expectationId });
    expect(premature.verdict).toBe('unresolved');
    expect(premature.comparisons).toEqual([]);

    await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);

    // Independent observation of actual repository reality: the snapshot on
    // disk does not match what the generator produces.
    await recordDevelopmentObservation({
      productId: P, check: CHECK, result: 'failed',
      detail: 'committed snapshot omits an object the migrations produce',
      observedAt: new Date(Date.now() - 30_000),
    });
    await resolveDevelopmentShadowing({ productId: P, expectationId });

    // Shadowing wrote nothing to the repository.
    expect(changedPaths(root)).toEqual(before);
  });

  it('is granted authority narrower than write access, and refuses everything else', async () => {
    const comparisonId = String(((await query(
      `SELECT c.id FROM responsibility_shadow_comparisons c
        JOIN responsibility_shadow_expectations e ON e.id=c.expectation_id
       WHERE e.responsibility_id=?`, [responsibilityId],
    )).rows[0] as Record<string, unknown>).id);

    const consentId = await grantDevelopmentAuthority({
      productId: P, responsibilityId, ownerId: OWNER, repository: REPO,
      allowedPathPrefixes: [SNAPSHOT], changeClass: 'generated_artifact',
      requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
    });
    await enterDevelopmentAssisting({
      productId: P, responsibilityId, shadowComparisonId: comparisonId, authorityConsentId: consentId,
    });

    const authority = {
      consentId, responsibilityId, repository: REPO, allowedPathPrefixes: [SNAPSHOT],
      changeClass: 'generated_artifact' as const, requiredVerification: [CHECK],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    // Exactly one artefact is reachable. Everything the owner put out of scope
    // is refused by the authority itself, not by convention.
    expect(isPathWithinAuthority(SNAPSHOT, authority)).toBe(true);
    for (const forbidden of [
      'src/db/migrations/135_anything.sql',   // inventing a migration
      'scripts/schema-snapshot.sh',           // changing the generator to hide a failure
      'src/services/institution/responsibility.ts',
      'src/index.ts', 'package.json', 'tests/unit/anything.test.ts',
      'docs/foundry-institution/IMPLEMENTATION_STATE.md',
      '../outside.txt', 'docs/db/../../etc/passwd',
    ]) {
      expect(isPathWithinAuthority(forbidden, authority), `${forbidden} must be refused`).toBe(false);
    }
  });

  it('carries the generated artefact and nothing else, then verifies the real diff', async () => {
    const signalId = String((((await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0]) as Record<string, unknown>).d).replace('signal_event:', '');
    for (const [predicate, value] of [
      ['development_need', { check: CHECK }],
      ['development_intended_content', { path: SNAPSHOT, content: GENERATED, changeClass: 'generated_artifact' }],
    ] as Array<[string, unknown]>) {
      await recordReconstructionClaim({
        productId: P, subject: `responsibility:${responsibilityId}`, predicate, value,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
        derivationMethod: 'output of the canonical generator', observedAt: new Date(),
      });
    }

    const plan = await planDevelopmentChange({ productId: P, responsibilityId, repository: REPO });
    // Planning writes nothing.
    expect(changedPaths(root)).toEqual([]);

    const { plan: executed } = await executeDevelopmentChange({
      productId: P, planId: plan.id, repositoryRoot: root, content: GENERATED,
    });
    expect(executed.status).toBe('applied');
    expect(readFileSync(join(root, SNAPSHOT), 'utf8')).toBe(GENERATED);

    // The real git diff is exactly the one artefact.
    expect(changedPaths(root)).toEqual([SNAPSHOT]);

    // Verification is still unresolved until an independent check runs AFTER
    // the change. Doing the thing is not evidence the thing worked.
    const unverified = await verifyDevelopmentChange({
      productId: P, planId: plan.id, repositoryRoot: root,
      expectedContent: GENERATED, observedChangedPaths: changedPaths(root),
    });
    expect(unverified).toMatchObject({ diffVerified: true, verificationStatus: 'unresolved', unexpectedPaths: [] });

    // A real verification run takes time; here the write and the check land in
    // the same second, and second-resolution timestamps make that ordering
    // ambiguous. The system correctly refuses to credit an ambiguous
    // observation, so the fixture makes the ordering genuine rather than
    // relaxing the rule.
    await query("UPDATE development_change_plans SET applied_at=datetime(applied_at,'-5 seconds') WHERE id=?",
      [plan.id]);
    await recordDevelopmentObservation({
      productId: P, check: CHECK, result: 'passed',
      detail: 'regeneration produces no difference from the committed snapshot',
    });
    const verified = await verifyDevelopmentChange({
      productId: P, planId: plan.id, repositoryRoot: root,
      expectedContent: GENERATED, observedChangedPaths: changedPaths(root),
    });
    expect(verified).toMatchObject({ diffVerified: true, verificationStatus: 'passed' });
  });

  it('fails an out-of-scope mutation even when the target file is perfect', async () => {
    // The gap this closes: everything else verifies the intended file, which
    // cannot see a second file that also changed. A generator with an
    // undocumented side effect produces a correct artefact and an unauthorised
    // repository, and every other check passes.
    writeFileSync(join(root, 'README.md'), 'touched by something nobody planned\n');
    const observed = changedPaths(root);
    expect(observed).toContain('README.md');

    const plan = (await query(
      'SELECT id FROM development_change_plans WHERE product_id=? ORDER BY rowid DESC LIMIT 1', [P],
    )).rows[0] as Record<string, unknown>;
    const result = await verifyDevelopmentChange({
      productId: P, planId: String(plan.id), repositoryRoot: root,
      expectedContent: GENERATED, observedChangedPaths: observed,
    });
    // Target bytes are still perfect, the required check still passed, and the
    // verification fails anyway.
    expect(readFileSync(join(root, SNAPSHOT), 'utf8')).toBe(GENERATED);
    expect(result.verificationStatus).toBe('failed');
    expect(result.diffVerified).toBe(false);
    expect(result.unexpectedPaths).toEqual(['README.md']);

    execFileSync('git', ['checkout', '--', 'README.md'], { cwd: root });
  });

  it('converges on replay instead of mutating twice', async () => {
    // A repeating pass must not be able to apply the same change again. Change
    // identity is derived from product, responsibility, path and content, so
    // re-planning the same intent returns the same plan rather than a second
    // one, and re-executing an already-applied plan writes nothing.
    const replanned = await planDevelopmentChange({ productId: P, responsibilityId, repository: REPO });
    const plans = (await query(
      'SELECT COUNT(*) n FROM development_change_plans WHERE product_id=?', [P],
    )).rows[0] as Record<string, unknown>;
    expect(Number(plans.n)).toBe(1);

    const before = readFileSync(join(root, SNAPSHOT), 'utf8');
    const { receipt } = await executeDevelopmentChange({
      productId: P, planId: replanned.id, repositoryRoot: root, content: GENERATED,
    });
    expect(receipt).toBeNull();                       // the claim was already taken
    expect(readFileSync(join(root, SNAPSHOT), 'utf8')).toBe(before);
    expect(changedPaths(root)).toEqual([SNAPSHOT]);   // still exactly one artefact
  });

  it('does not mutate when authority is withdrawn between planning and execution', async () => {
    // The hardest window the architecture supports, on the recursive path:
    // a plan made under a valid grant, executed after the owner withdrew it.
    // Being the company that runs the platform buys no exemption.
    const second = freshRepo();
    const signalId = String((((await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0]) as Record<string, unknown>).d).replace('signal_event:', '');

    // The first intent was fulfilled, so it is no longer current. Two live
    // proposals for one need correctly make the disposition `defer` — "which
    // one is right is not established" — so the fulfilled one is expired
    // through the ordinary validity mechanism rather than left to compete.
    await query(
      `UPDATE reconstruction_claims SET valid_until=datetime('now','-1 second')
        WHERE product_id=? AND predicate='development_intended_content'`, [P]);

    const NEXT = GENERATED + 'CREATE TABLE c (id TEXT);\n';
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:${responsibilityId}`, predicate: 'development_intended_content',
      value: { path: SNAPSHOT, content: NEXT, changeClass: 'generated_artifact' },
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
      derivationMethod: 'output of the canonical generator after a further migration', observedAt: new Date(),
    });

    const plan = await planDevelopmentChange({ productId: P, responsibilityId, repository: REPO });
    const consentId = String(((await query(
      'SELECT authority_consent_id c FROM development_change_plans WHERE id=?', [plan.id],
    )).rows[0] as Record<string, unknown>).c);

    await revokeDevelopmentAuthority(P, consentId, OWNER);

    const { plan: refused, receipt } = await executeDevelopmentChange({
      productId: P, planId: plan.id, repositoryRoot: second, content: NEXT,
    });
    expect(refused.status).toBe('refused');
    expect(refused.refusedReason).toBe('authority_absent');
    expect(receipt).toBeNull();
    // Nothing was written. Revocation is not a warning.
    expect(changedPaths(second)).toEqual([]);
    expect(readFileSync(join(second, SNAPSHOT), 'utf8')).toBe(STALE);
  });

  it('cannot revive a dead plan with a fresh grant', async () => {
    // Re-granting is a new decision, not a resumption. The refused plan stays
    // refused — otherwise revocation would only ever be a pause.
    const second = freshRepo();
    const refusedPlan = (await query(
      "SELECT id FROM development_change_plans WHERE product_id=? AND status='refused' ORDER BY rowid DESC LIMIT 1", [P],
    )).rows[0] as Record<string, unknown>;

    await grantDevelopmentAuthority({
      productId: P, responsibilityId, ownerId: OWNER, repository: REPO,
      allowedPathPrefixes: [SNAPSHOT], changeClass: 'generated_artifact',
      requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
    });

    const { receipt } = await executeDevelopmentChange({
      productId: P, planId: String(refusedPlan.id), repositoryRoot: second,
      content: GENERATED + 'CREATE TABLE c (id TEXT);\n',
    });
    expect(receipt).toBeNull();
    expect(changedPaths(second)).toEqual([]);
  });

  it('is a pure rule about change sets, and is not assumed clean when unobserved', () => {
    expect(verifyDiffScope({ observedChangedPaths: [SNAPSHOT], plannedPaths: [SNAPSHOT] }))
      .toEqual({ withinScope: true, unexpected: [] });
    expect(verifyDiffScope({ observedChangedPaths: [], plannedPaths: [SNAPSHOT] }))
      .toEqual({ withinScope: true, unexpected: [] });
    expect(verifyDiffScope({
      observedChangedPaths: ['./' + SNAPSHOT, 'package-lock.json', 'src/index.ts'], plannedPaths: [SNAPSHOT],
    })).toEqual({ withinScope: false, unexpected: ['package-lock.json', 'src/index.ts'] });
  });
});
