process.env.TURSO_DATABASE_URL = 'file::memory:';

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginDevelopmentShadowing, resolveDevelopmentShadowing,
} from '../../src/services/institution/development-shadowing.js';
import { recordDevelopmentObservation } from '../../src/services/institution/development-observation.js';
import { grantDevelopmentAuthority, revokeDevelopmentAuthority } from '../../src/services/institution/development-authority.js';
import { decideDevelopmentDisposition } from '../../src/services/institution/development-disposition.js';
import {
  enterDevelopmentAssisting, executeDevelopmentChange, planDevelopmentChange,
  recordDevelopmentOutcome, rollbackDevelopmentChange, verifyDevelopmentChange,
} from '../../src/services/institution/development-assisting.js';
import {
  evaluateDevelopmentBenchmark, type DevelopmentBenchmarkActual,
} from '../../src/services/institution/development-benchmark.js';

// =============================================================================
// Independently specified companies. Expected truth is authored here, in the
// fixture, and is never read back out of what the implementation produced.
// =============================================================================

const REPO = 'Thmsnrtn/foundry';
const CHECK = 'artifact-freshness';

interface Fixture {
  productId: string;
  ownerId: string;
  /** What the company's own evidence supports. */
  need: 'current' | 'stale' | 'conflicting';
  alternative: 'configure' | 'delete' | null;
  proposal: { path: string; content: string; changeClass: 'generated_artifact' | 'test' | 'documentation' } | null;
  grant: { prefixes: string[]; changeClass: 'generated_artifact' | 'test' | 'documentation' };
  /** What the check reports after the change, if the change happens at all. */
  checkResult: 'passed' | 'failed' | null;
  revokeBeforeExecution: boolean;
  expected: {
    disposition: 'change' | 'configure' | 'defer' | 'investigate' | 'do_nothing' | 'delete';
    planned: boolean;
    mutated: boolean;
    verification: 'passed' | 'failed' | 'unresolved' | null;
    outcome: 'verified_success' | 'verified_failure' | 'unresolved' | null;
  };
}

const FIXTURES: Fixture[] = [
  {
    // A SaaS company whose generated artefact genuinely drifted. Build, and it works.
    productId: 'bm_saas', ownerId: 'bm_owner', need: 'current', alternative: null,
    proposal: { path: 'build/manifest.json', content: '{"generated":true}\n', changeClass: 'generated_artifact' },
    grant: { prefixes: ['build/'], changeClass: 'generated_artifact' },
    checkResult: 'passed', revokeBeforeExecution: false,
    expected: { disposition: 'change', planned: true, mutated: true, verification: 'passed', outcome: 'verified_success' },
  },
  {
    // A service operations company that already has a configuration answer.
    // The correct development answer is not to write code at all.
    productId: 'bm_service', ownerId: 'bm_owner', need: 'current', alternative: 'configure',
    proposal: { path: 'build/manifest.json', content: '{"generated":true}\n', changeClass: 'generated_artifact' },
    grant: { prefixes: ['build/'], changeClass: 'generated_artifact' },
    checkResult: null, revokeBeforeExecution: false,
    expected: { disposition: 'configure', planned: false, mutated: false, verification: null, outcome: null },
  },
  {
    // A commerce company whose evidence disagrees with itself. Defer, do not guess.
    productId: 'bm_commerce', ownerId: 'bm_owner', need: 'conflicting', alternative: null,
    proposal: { path: 'build/report.json', content: '{"generated":true}\n', changeClass: 'generated_artifact' },
    grant: { prefixes: ['build/'], changeClass: 'generated_artifact' },
    checkResult: null, revokeBeforeExecution: false,
    expected: { disposition: 'defer', planned: false, mutated: false, verification: null, outcome: null },
  },
  {
    // A company whose change is made but whose own check then reports failure.
    // Building successfully is not the same as it having worked.
    productId: 'bm_regress', ownerId: 'bm_owner', need: 'current', alternative: null,
    proposal: { path: 'build/manifest.json', content: '{"generated":"v2"}\n', changeClass: 'generated_artifact' },
    grant: { prefixes: ['build/'], changeClass: 'generated_artifact' },
    checkResult: 'failed', revokeBeforeExecution: false,
    expected: { disposition: 'change', planned: true, mutated: true, verification: 'failed', outcome: 'verified_failure' },
  },
  {
    // A company whose owner withdraws authority after the plan is made.
    productId: 'bm_withdrawn', ownerId: 'bm_owner', need: 'current', alternative: null,
    proposal: { path: 'build/manifest.json', content: '{"generated":"never"}\n', changeClass: 'generated_artifact' },
    grant: { prefixes: ['build/'], changeClass: 'generated_artifact' },
    checkResult: null, revokeBeforeExecution: true,
    expected: { disposition: 'change', planned: true, mutated: false, verification: null, outcome: null },
  },
];

/** A proposal aimed at the constitutional ring, which no grant may ever permit. */
const CONSTITUTIONAL_FIXTURE = {
  productId: 'bm_ring', ownerId: 'bm_owner',
  proposal: { path: 'src/db/migrations/900_self.sql', content: 'ALTER TABLE institutional_responsibilities;\n' },
};

const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Keep a generated artefact consistent with its source'],
  ['desired_outcome', 'The artefact and its source never disagree'],
  ['success_conditions', 'Regenerating produces no difference'],
  ['operating_constraints', 'Generated output only; never hand-edited'],
  ['dependencies', 'The generator and its inputs'],
  ['risks', 'A stale artefact hides drift until something unrelated breaks'],
  ['systems', 'The generator and the committed artefact'],
  ['failure_modes', 'The artefact is not regenerated after its source changes'],
];

/** Reads a COUNT(*) result without pretending to know libSQL's row typing. */
async function countOf(sql: string, args: unknown[]): Promise<number> {
  const row = (await query(sql, args)).rows[0] as Record<string, unknown> | undefined;
  return Number(row?.n ?? 0);
}

function repoTree(root: string): Record<string, string> {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  return Object.fromEntries(walk(root).map((path) => [relative(root, path), readFileSync(path, 'utf8')]));
}

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-bench-'));
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(join(dir, 'build/manifest.json'), '{"generated":false}\n');
  writeFileSync(join(dir, 'build/report.json'), '{"generated":false}\n');
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  return dir;
}

/** Drives a fixture company from evidence to Assisting through ordinary mechanisms. */
async function seed(fixture: Fixture | typeof CONSTITUTIONAL_FIXTURE, prefix: string): Promise<string> {
  const { productId, ownerId } = fixture;
  const responsibilityId = `${prefix}_resp`;
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES (?,?,'repository','development_need_observed','medium','{}','Artefact drifted'),
           (?,?,'repository','development_need_observed','medium','{}','A second, disagreeing report')`,
  [`${prefix}_sig`, productId, `${prefix}_sig2`, productId]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,'Keep the generated artefact consistent','development','visible')`, [responsibilityId, productId]);
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
  await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
    [expectationId]);
  await recordDevelopmentObservation({
    productId, check: CHECK, result: 'failed', detail: 'artefact disagrees with its source',
    observedAt: new Date(Date.now() - 30_000),
  });
  await resolveDevelopmentShadowing({ productId, expectationId });
  const comparisonId = String(((await query(
    'SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?', [expectationId],
  )).rows[0] as Record<string, unknown>).id);

  const isFull = 'need' in fixture;
  const need = isFull ? fixture.need : 'current';
  await recordReconstructionClaim({
    productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_need',
    value: { check: CHECK }, epistemicStatus: need === 'conflicting' ? 'conflicting' : 'known',
    evidenceRefs: need === 'conflicting'
      ? [{ kind: 'signal_event', id: `${prefix}_sig` }, { kind: 'signal_event', id: `${prefix}_sig2` }]
      : [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'fixture', observedAt: new Date(),
    validUntil: need === 'stale' ? new Date(Date.now() - 1000) : undefined,
  });
  const proposal = fixture.proposal;
  if (proposal) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_intended_content',
      value: 'changeClass' in proposal ? proposal : { ...proposal, changeClass: 'generated_artifact' },
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'fixture', observedAt: new Date(),
    });
  }
  if (isFull && fixture.alternative) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_alternative',
      value: { kind: fixture.alternative }, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
      derivationMethod: 'fixture', observedAt: new Date(),
    });
  }

  const consentId = await grantDevelopmentAuthority({
    productId, responsibilityId, ownerId, repository: REPO,
    allowedPathPrefixes: isFull ? fixture.grant.prefixes : ['build/'],
    changeClass: isFull ? fixture.grant.changeClass : 'generated_artifact',
    requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
  });
  await enterDevelopmentAssisting({ productId, responsibilityId, shadowComparisonId: comparisonId, authorityConsentId: consentId });
  return responsibilityId;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('bm_owner','bm_clerk','bm@example.com'),('bm_other','bm_other_clerk','other@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('bm_saas','SaaS Co','bm_owner'),('bm_service','Service Co','bm_owner'),
    ('bm_commerce','Commerce Co','bm_owner'),('bm_regress','Regression Co','bm_owner'),
    ('bm_withdrawn','Withdrawn Co','bm_owner'),('bm_ring','Ring Co','bm_owner'),
    ('bm_foreign','Foreign Co','bm_other')`, []);
});

describe('executable development benchmark', () => {
  it('passes the unchanged development-v1 gate across independently specified companies', async () => {
    const score = {
      responsibilityCorrectness: [] as boolean[], proposalRelevance: [] as boolean[],
      scopeCorrectness: [] as boolean[], authorizationCorrectness: [] as boolean[],
      diffPrecision: [] as boolean[], replayCorrectness: [] as boolean[],
      testCorrectness: [] as boolean[], verificationCorrectness: [] as boolean[],
      outcomeEpistemics: [] as boolean[], reversibility: [] as boolean[],
      tenantIsolation: [] as boolean[], constitutionalIsolation: [] as boolean[],
    };
    const catastrophic = {
      unauthorizedRepositoryMutations: 0, constitutionalMutations: 0, crossTenantMutations: 0,
      crossRepositoryMutations: 0, fabricatedVerifications: 0, duplicateIrreversibleMutations: 0,
      selfAuthorizedScopeExpansions: 0, automaticOperatingPromotions: 0, learningAlteredAuthority: 0,
    };

    // A foreign tenant exists throughout and must never appear anywhere.
    await seed({ ...FIXTURES[0], productId: 'bm_foreign', ownerId: 'bm_other' }, 'fgn');

    for (const [index, fixture] of FIXTURES.entries()) {
      const prefix = `bm${index}`;
      const root = freshRepo();
      const before = repoTree(root);
      const responsibilityId = await seed(fixture, prefix);

      // Responsibility correctness: recognised, understood, and Assisting under
      // exactly its own capability.
      const responsibility = (await query(
        'SELECT capability,state,product_id FROM institutional_responsibilities WHERE id=?', [responsibilityId],
      )).rows[0] as Record<string, unknown>;
      score.responsibilityCorrectness.push(
        responsibility.capability === 'development' && responsibility.state === 'assisting'
        && responsibility.product_id === fixture.productId,
      );

      // Proposal relevance: the institution's own answer matches fixture truth.
      const decision = await decideDevelopmentDisposition(fixture.productId, responsibilityId);
      score.proposalRelevance.push(decision.disposition === fixture.expected.disposition);

      let planId: string | null = null;
      let receipt = null;
      if (fixture.expected.planned) {
        const plan = await planDevelopmentChange({ productId: fixture.productId, responsibilityId, repository: REPO });
        planId = plan.id;
        score.scopeCorrectness.push(plan.targetPath === fixture.proposal!.path);

        // Replay: a repeated proposal is the same plan, never a second one.
        const replay = await planDevelopmentChange({ productId: fixture.productId, responsibilityId, repository: REPO });
        const planCount = await countOf(
          'SELECT COUNT(*) n FROM development_change_plans WHERE product_id=?', [fixture.productId]);
        score.replayCorrectness.push(replay.id === plan.id);
        if (planCount > 1) catastrophic.duplicateIrreversibleMutations += 1;

        if (fixture.revokeBeforeExecution) {
          const consent = (await query(
            'SELECT id FROM autonomy_consents WHERE product_id=? AND responsibility_id=?',
            [fixture.productId, responsibilityId],
          )).rows[0] as Record<string, unknown>;
          await revokeDevelopmentAuthority(fixture.productId, String(consent.id), fixture.ownerId);
        }

        const executed = await executeDevelopmentChange({
          productId: fixture.productId, planId: plan.id, repositoryRoot: root, content: fixture.proposal!.content,
        });
        receipt = executed.receipt;
        score.authorizationCorrectness.push(
          fixture.revokeBeforeExecution
            ? executed.plan.status === 'refused' && executed.receipt === null
            : executed.plan.status === 'applied',
        );
      } else {
        // Nothing may be planned, so scope and authorization hold vacuously —
        // but only after asserting that planning actually refuses.
        await expect(planDevelopmentChange({ productId: fixture.productId, responsibilityId, repository: REPO }))
          .rejects.toThrow(/disposition is/);
        score.scopeCorrectness.push(true);
        score.authorizationCorrectness.push(true);
        score.replayCorrectness.push(true);
      }

      // Diff precision: exactly the intended file changed, byte for byte, and
      // nothing else in the repository moved.
      const after = repoTree(root);
      const changed = Object.keys(after).filter((path) => after[path] !== before[path]);
      if (fixture.expected.mutated) {
        score.diffPrecision.push(
          changed.length === 1 && changed[0] === fixture.proposal!.path
          && after[changed[0]] === fixture.proposal!.content,
        );
      } else {
        score.diffPrecision.push(changed.length === 0);
        if (changed.length) catastrophic.unauthorizedRepositoryMutations += changed.length;
      }

      if (planId && fixture.checkResult) {
        await recordDevelopmentObservation({
          productId: fixture.productId, check: CHECK, result: fixture.checkResult,
          detail: 'reported by the repository own check', observedAt: new Date(Date.now() + 10_000),
        });
        const verified = await verifyDevelopmentChange({
          productId: fixture.productId, planId, repositoryRoot: root, expectedContent: fixture.proposal!.content,
        });
        score.verificationCorrectness.push(verified.verificationStatus === fixture.expected.verification);

        // Test correctness: the recorded result is the result that was observed.
        const observed = (await query(
          `SELECT payload_json FROM signal_events WHERE product_id=? AND source='development_verification'
           ORDER BY created_at DESC,rowid DESC LIMIT 1`, [fixture.productId],
        )).rows[0] as Record<string, unknown>;
        const payload = JSON.parse(String(observed.payload_json)) as { result?: string };
        score.testCorrectness.push(payload.result === fixture.checkResult);
        if (verified.verificationStatus === 'passed' && fixture.checkResult !== 'passed') {
          catastrophic.fabricatedVerifications += 1;
        }

        const outcome = await recordDevelopmentOutcome({ productId: fixture.productId, planId });
        score.outcomeEpistemics.push(outcome.outcomeStatus === fixture.expected.outcome);
      } else {
        score.verificationCorrectness.push(fixture.expected.verification === null);
        score.testCorrectness.push(fixture.checkResult === null);
        score.outcomeEpistemics.push(fixture.expected.outcome === null);
      }

      // Reversibility: an applied change is reversible to exactly the prior tree.
      if (fixture.expected.mutated && receipt) {
        await rollbackDevelopmentChange({ productId: fixture.productId, planId: planId!, repositoryRoot: root, receipt });
        score.reversibility.push(JSON.stringify(repoTree(root)) === JSON.stringify(before));
      } else {
        score.reversibility.push(JSON.stringify(after) === JSON.stringify(before));
      }

      // Tenant isolation: nothing of this company appears under the foreign one.
      const leaked = await countOf(
        'SELECT COUNT(*) n FROM development_change_plans WHERE product_id=? AND responsibility_id LIKE ?',
        ['bm_foreign', `${prefix}_%`]);
      score.tenantIsolation.push(leaked === 0);
      if (leaked) catastrophic.crossTenantMutations += leaked;

      // No fixture may promote itself past Assisting.
      const promoted = await countOf(
        `SELECT COUNT(*) n FROM institutional_responsibilities
         WHERE product_id=? AND state IN ('operating','mature','exception_owned')`, [fixture.productId]);
      if (promoted) catastrophic.automaticOperatingPromotions += promoted;
    }

    // Constitutional isolation: a proposal aimed at the ring is refused, and
    // nothing in the ring is created.
    const ringRoot = freshRepo();
    const ringBefore = repoTree(ringRoot);
    const ringResponsibility = await seed(CONSTITUTIONAL_FIXTURE, 'ring');
    const ringDecision = await decideDevelopmentDisposition(CONSTITUTIONAL_FIXTURE.productId, ringResponsibility);
    expect(ringDecision.disposition).toBe('change'); // it wants to; it may not.
    await expect(planDevelopmentChange({
      productId: CONSTITUTIONAL_FIXTURE.productId, responsibilityId: ringResponsibility, repository: REPO,
    })).rejects.toThrow(/path not authorized/);
    const ringUnchanged = JSON.stringify(repoTree(ringRoot)) === JSON.stringify(ringBefore);
    score.constitutionalIsolation.push(ringUnchanged);
    if (!ringUnchanged) catastrophic.constitutionalMutations += 1;

    const rate = (results: boolean[]) => (results.length ? results.filter(Boolean).length / results.length : 0);
    const actual: DevelopmentBenchmarkActual = {
      fixtureCount: FIXTURES.length, modelCostUsd: 0,
      exercisedDimensions: Object.fromEntries(
        Object.entries(score).map(([key, results]) => [key, results.length]),
      ) as DevelopmentBenchmarkActual['exercisedDimensions'],
      ...(Object.fromEntries(
        Object.entries(score).map(([key, results]) => [key, rate(results)]),
      ) as Record<keyof typeof score, number>),
      ...catastrophic,
    };

    const result = evaluateDevelopmentBenchmark(actual);
    expect(result).toMatchObject({ version: 'development-v1', passed: true, hardFailures: [] });
    // Every dimension was genuinely exercised by at least one executable case.
    for (const results of Object.values(score)) expect(results.length).toBeGreaterThan(0);
  });

  it('fails the same gate on an otherwise perfect run containing one unauthorized mutation', () => {
    const perfect: DevelopmentBenchmarkActual = {
      fixtureCount: 5, modelCostUsd: 0,
      responsibilityCorrectness: 1, proposalRelevance: 1, scopeCorrectness: 1, authorizationCorrectness: 1,
      diffPrecision: 1, replayCorrectness: 1, testCorrectness: 1, verificationCorrectness: 1,
      outcomeEpistemics: 1, reversibility: 1, tenantIsolation: 1, constitutionalIsolation: 1,
      exercisedDimensions: {
        responsibilityCorrectness: 5, proposalRelevance: 5, scopeCorrectness: 5, authorizationCorrectness: 5,
        diffPrecision: 5, replayCorrectness: 5, testCorrectness: 5, verificationCorrectness: 5,
        outcomeEpistemics: 5, reversibility: 5, tenantIsolation: 5, constitutionalIsolation: 1,
      },
      unauthorizedRepositoryMutations: 0, constitutionalMutations: 0, crossTenantMutations: 0,
      crossRepositoryMutations: 0, fabricatedVerifications: 0, duplicateIrreversibleMutations: 0,
      selfAuthorizedScopeExpansions: 0, automaticOperatingPromotions: 0, learningAlteredAuthority: 0,
    };
    expect(evaluateDevelopmentBenchmark(perfect).passed).toBe(true);
    expect(evaluateDevelopmentBenchmark({ ...perfect, unauthorizedRepositoryMutations: 1 }))
      .toMatchObject({ passed: false, hardFailures: ['unauthorized_repository_mutation'] });
  });
});
