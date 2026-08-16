process.env.TURSO_DATABASE_URL = 'file::memory:';

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  CONSTITUTIONAL_PATHS, grantDevelopmentAuthority, isConstitutionalPath,
} from '../../src/services/institution/development-authority.js';
import {
  enterDevelopmentAssisting, executeDevelopmentChange, planDevelopmentChange,
} from '../../src/services/institution/development-assisting.js';
import { enterResponsibilityAssisting } from '../../src/services/institution/responsibility-assisting.js';

// =============================================================================
// Foundry may operate Foundry. Foundry may improve Foundry. Foundry may NOT be
// a special case while doing it.
//
// The company under management here is literally named "Foundry" and is run
// through the identical mechanisms every other company uses. Nothing about
// being Foundry may shorten the ladder, widen a grant, or reach the ring.
// =============================================================================

const REPO = 'Thmsnrtn/foundry';
const CHECK = 'artifact-freshness';
const TARGET = 'build/manifest.json';
const CONTENT = '{"generated":true}\n';

const UNDERSTANDING: Array<[string, unknown]> = [
  ['purpose', 'Keep a generated artefact consistent with its source'],
  ['desired_outcome', 'The artefact and its source never disagree'],
  ['success_conditions', 'Regenerating produces no difference'],
  ['operating_constraints', 'Generated output only; never hand-edited'],
  ['dependencies', 'The generator and its inputs'],
  ['risks', 'A stale artefact hides drift'],
  ['systems', 'The generator and the committed artefact'],
  ['failure_modes', 'The artefact is not regenerated after its source changes'],
];

let root: string;

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-recursive-'));
  mkdirSync(join(dir, 'build'), { recursive: true });
  writeFileSync(join(dir, TARGET), '{"generated":false}\n');
  return dir;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('rc_owner','rc_clerk','owner@foundry.example'),('rc_other','rc_other_clerk','other@example.com')`, []);
  // The Foundry company is an ordinary product row with an ordinary owner.
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('rc_foundry','Foundry','rc_owner'),('rc_customer','Customer Co','rc_other')`, []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
    VALUES ('rc_sig','rc_foundry','repository','development_need_observed','medium','{}','Artefact drifted'),
           ('rc_cust_sig','rc_customer','repository','development_need_observed','medium','{}','Artefact drifted')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    ('rc_resp','rc_foundry','Keep the generated artefact consistent','development','visible'),
    ('rc_cust_resp','rc_customer','Keep the generated artefact consistent','development','visible')`, []);
  root = freshRepo();
});

describe('recursive institution: Foundry is an ordinary company', () => {
  it('must climb the identical ladder — being Foundry skips no rung', async () => {
    // Understood cannot be assumed. Before the facts exist, it is refused.
    await expect(earnResponsibilityUnderstanding('rc_foundry', 'rc_resp'))
      .rejects.toThrow(/insufficient/);

    for (const [predicate, value] of UNDERSTANDING) {
      await recordReconstructionClaim({
        productId: 'rc_foundry', subject: 'responsibility:rc_resp', predicate, value,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: 'rc_sig' }],
        derivationMethod: 'observed repository reality', observedAt: new Date(),
      });
    }
    expect(await earnResponsibilityUnderstanding('rc_foundry', 'rc_resp'))
      .toMatchObject({ state: 'understood', authorityRef: null });

    // Assisting cannot be entered without real Shadowing evidence and a real
    // grant, however self-evidently competent the company believes itself.
    await expect(enterResponsibilityAssisting({
      productId: 'rc_foundry', responsibilityId: 'rc_resp',
      shadowComparisonId: 'invented', authorityConsentId: 'invented',
    })).rejects.toThrow();

    const expectationClaimId = await recordReconstructionClaim({
      productId: 'rc_foundry', subject: 'responsibility:rc_resp', predicate: 'development_expectation',
      value: { check: CHECK, expected: 'failed' }, epistemicStatus: 'inferred', confidence: 0.8,
      evidenceRefs: [{ kind: 'signal_event', id: 'rc_sig' }],
      derivationMethod: 'bounded expectation', observedAt: new Date(),
    });
    const { expectationId } = await beginDevelopmentShadowing({
      productId: 'rc_foundry', responsibilityId: 'rc_resp', expectedCheck: CHECK, expectedResult: 'failed',
      expectationClaimId, observationSourceSignalId: 'rc_sig',
    });
    await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);
    await recordDevelopmentObservation({
      productId: 'rc_foundry', check: CHECK, result: 'failed', detail: 'artefact disagrees with its source',
      observedAt: new Date(Date.now() - 30_000),
    });
    await resolveDevelopmentShadowing({ productId: 'rc_foundry', expectationId });

    for (const [predicate, value] of [
      ['development_need', { check: CHECK }],
      ['development_intended_content', { path: TARGET, content: CONTENT, changeClass: 'generated_artifact' }],
    ] as Array<[string, unknown]>) {
      await recordReconstructionClaim({
        productId: 'rc_foundry', subject: 'responsibility:rc_resp', predicate, value, epistemicStatus: 'known',
        evidenceRefs: [{ kind: 'signal_event', id: 'rc_sig' }], derivationMethod: 'fixture', observedAt: new Date(),
      });
    }

    const consentId = await grantDevelopmentAuthority({
      productId: 'rc_foundry', responsibilityId: 'rc_resp', ownerId: 'rc_owner', repository: REPO,
      allowedPathPrefixes: ['build/'], changeClass: 'generated_artifact',
      requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
    });
    const comparisonId = String(((await query(
      'SELECT id FROM responsibility_shadow_comparisons WHERE expectation_id=?', [expectationId],
    )).rows[0] as Record<string, unknown>).id);
    await enterDevelopmentAssisting({
      productId: 'rc_foundry', responsibilityId: 'rc_resp',
      shadowComparisonId: comparisonId, authorityConsentId: consentId,
    });

    const plan = await planDevelopmentChange({ productId: 'rc_foundry', responsibilityId: 'rc_resp', repository: REPO });
    const { plan: executed } = await executeDevelopmentChange({
      productId: 'rc_foundry', planId: plan.id, repositoryRoot: root, content: CONTENT,
    });
    expect(executed.status).toBe('applied');
    expect(readFileSync(join(root, TARGET), 'utf8')).toBe(CONTENT);

    // Operating remains frozen for Foundry exactly as for everyone else.
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='rc_resp'", [])).rows[0])
      .toMatchObject({ state: 'assisting' });
  });

  it('cannot grant itself authority over its own constitution', async () => {
    for (const prefixes of [['src/db/migrations/'], ['docs/foundry-institution/'], ['scripts/'], ['src/'], ['']]) {
      await expect(grantDevelopmentAuthority({
        productId: 'rc_foundry', responsibilityId: 'rc_resp', ownerId: 'rc_owner', repository: REPO,
        allowedPathPrefixes: prefixes, changeClass: 'generated_artifact',
        requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
      })).rejects.toThrow(/constitutional_scope|path_invalid/);
    }
  });

  it('cannot reach another company through being the company that runs the platform', async () => {
    // Operating Foundry confers nothing over a customer's product.
    await expect(planDevelopmentChange({
      productId: 'rc_foundry', responsibilityId: 'rc_cust_resp', repository: REPO,
    })).rejects.toThrow(/disposition is do_nothing/);
    await expect(grantDevelopmentAuthority({
      productId: 'rc_customer', responsibilityId: 'rc_cust_resp', ownerId: 'rc_owner', repository: REPO,
      allowedPathPrefixes: ['build/'], changeClass: 'generated_artifact',
      requiredVerification: [CHECK], expiresAt: new Date(Date.now() + 3_600_000),
    })).rejects.toThrow(/invalid_binding/);
    expect((await query("SELECT COUNT(*) n FROM development_change_plans WHERE product_id='rc_customer'", [])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('has no self-management branch anywhere in the institutional kernel', () => {
    // The invariant is structural, not a promise: if no institution module can
    // recognise that it is operating Foundry, it cannot treat Foundry
    // differently. A new special case fails here rather than in production.
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
    });
    const kernel = [
      ...walk(resolve(process.cwd(), 'src/services/institution')),
      ...walk(resolve(process.cwd(), 'src/services/outbound')),
    ];
    // Precisely: resolving Foundry as a *company, product, or tenant*. Note
    // this is not a ban on the word — `outbound/sender-of-record.ts` checks
    // whether a From address is a Foundry *domain*, which is a deliverability
    // and liability concern about who a message appears to come from, not a
    // claim about which company is being operated.
    const selfAware = kernel.filter((path) => {
      const source = readFileSync(path, 'utf8');
      return /name\s*=\s*['"]Foundry['"]/.test(source)
        || /product_id\s*=\s*['"]foundry/i.test(source)
        || /FOUNDRY_PRODUCT|isFoundryProduct|isFoundryCompany|isFoundryTenant/i.test(source)
        // Migration 123 gave Foundry a canonical identity so the *platform*
        // paths stop guessing at a display name. The kernel must still not be
        // able to ask the question at all: resolving canonical identity inside
        // the institution would reintroduce exactly the special case this
        // invariant exists to forbid.
        || /system_identities|resolveFoundryProductId|resolveSystemIdentity|FOUNDRY_IDENTITY_KEY/.test(source);
    });
    expect(selfAware).toEqual([]);
  });

  it('keeps the constitutional ring self-protecting', () => {
    // Widening the ring requires editing a migration, and migrations are
    // themselves inside the ring — so no ordinary development authority,
    // Foundry's included, can move the boundary that binds it.
    expect(CONSTITUTIONAL_PATHS).toContain('src/db/migrations/');
    expect(isConstitutionalPath('src/db/migrations/120_development_authority.sql')).toBe(true);
    expect(isConstitutionalPath('src/db/migrations/999_widen_the_ring.sql')).toBe(true);
  });
});
