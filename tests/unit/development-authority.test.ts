process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import { beginDevelopmentShadowing } from '../../src/services/institution/development-shadowing.js';
import {
  CONSTITUTIONAL_PATHS, getCurrentDevelopmentAuthority, grantDevelopmentAuthority,
  isConstitutionalPath, isPathWithinAuthority, revokeDevelopmentAuthority,
  type DevelopmentAuthority,
} from '../../src/services/institution/development-authority.js';

const CHECK = 'schema-snapshot-freshness';
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

const IN_ONE_HOUR = () => new Date(Date.now() + 3_600_000);

async function seedShadowingDevelopmentResponsibility(productId: string, prefix: string): Promise<string> {
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
  const claimId = await recordReconstructionClaim({
    productId, subject: `responsibility:${responsibilityId}`, predicate: 'development_expectation',
    value: { check: CHECK, expected: 'passed' }, epistemicStatus: 'inferred', confidence: 0.8,
    evidenceRefs: [{ kind: 'signal_event', id: `${prefix}_sig` }],
    derivationMethod: 'bounded expectation', observedAt: new Date(),
  });
  await beginDevelopmentShadowing({
    productId, responsibilityId, expectedCheck: CHECK, expectedResult: 'passed',
    expectationClaimId: claimId, observationSourceSignalId: `${prefix}_sig`,
  });
  return responsibilityId;
}

const validGrant = (productId: string, responsibilityId: string, ownerId: string) => ({
  productId, responsibilityId, ownerId,
  repository: 'Thmsnrtn/foundry', allowedPathPrefixes: ['docs/db/'],
  changeClass: 'generated_artifact' as const, requiredVerification: [CHECK, 'npm run check'],
  expiresAt: IN_ONE_HOUR(),
});

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    ('da_owner','da_clerk','da@example.com'),('da_other','da_other_clerk','other@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('da_product','Owned Co','da_owner'),('da_foreign','Foreign Co','da_other')`, []);
  await seedShadowingDevelopmentResponsibility('da_product', 'da');
  await seedShadowingDevelopmentResponsibility('da_foreign', 'daf');
  // A non-development responsibility in the same product, for substitution tests.
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES ('da_support','da_product','Answer support','customer_support','shadowing')`, []);
});

describe('responsibility-bound development authority', () => {
  it('has no broad code-writing permission anywhere in the ledger', async () => {
    const columns = (await query('PRAGMA table_info(autonomy_consents)', [])).rows
      .map((r) => String((r as Record<string, unknown>).name));
    expect(columns).not.toContain('can_write_code');
    expect(columns).toEqual(expect.arrayContaining([
      'responsibility_id', 'repository_ref', 'allowed_path_prefixes_json',
      'allowed_change_class', 'required_verification_json', 'expires_at', 'revoked_at',
    ]));
  });

  it('grants exactly one bounded, expiring, revocable development authority', async () => {
    const consentId = await grantDevelopmentAuthority(validGrant('da_product', 'da_resp', 'da_owner'));
    const authority = await getCurrentDevelopmentAuthority('da_product', 'da_resp');
    expect(authority).toMatchObject({
      consentId, responsibilityId: 'da_resp', repository: 'Thmsnrtn/foundry',
      allowedPathPrefixes: ['docs/db/'], changeClass: 'generated_artifact',
      requiredVerification: [CHECK, 'npm run check'],
    });
    // Authority alone carries the responsibility no further.
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='da_resp'", [])).rows[0])
      .toMatchObject({ state: 'shadowing' });
  });

  it('refuses a grant that reaches into the constitutional ring, in either direction', async () => {
    for (const prefixes of [
      ['src/db/migrations/'],            // directly inside the ring
      ['docs/foundry-institution/'],
      ['scripts/'],
      ['src/services/institution/'],
      ['src/services/outbound/'],
      ['AGENTS.md'],
      ['src/'],                          // broad enough to contain ring paths
      ['docs/'],
      [''],                              // the whole repository
      ['docs/db/', 'scripts/'],          // one legitimate prefix does not launder another
    ]) {
      await expect(grantDevelopmentAuthority({
        ...validGrant('da_product', 'da_resp', 'da_owner'), allowedPathPrefixes: prefixes,
      })).rejects.toThrow(/constitutional_scope|path_invalid/);
    }
  });

  it('refuses path escapes, absolute paths, invented change classes, and unverifiable or unbounded grants', async () => {
    const base = validGrant('da_product', 'da_resp', 'da_owner');
    await expect(grantDevelopmentAuthority({ ...base, allowedPathPrefixes: ['../other-repo/'] }))
      .rejects.toThrow(/path_invalid/);
    await expect(grantDevelopmentAuthority({ ...base, allowedPathPrefixes: ['/etc/'] }))
      .rejects.toThrow(/path_invalid/);
    await expect(grantDevelopmentAuthority({ ...base, allowedPathPrefixes: [] }))
      .rejects.toThrow(/paths_required/);
    await expect(grantDevelopmentAuthority({ ...base, repository: '  ' }))
      .rejects.toThrow(/repository_required/);
    await expect(grantDevelopmentAuthority({ ...base, changeClass: 'source_code' as never }))
      .rejects.toThrow(/change_class_invalid/);
    await expect(grantDevelopmentAuthority({ ...base, requiredVerification: [] }))
      .rejects.toThrow(/verification_required/);
    await expect(grantDevelopmentAuthority({ ...base, expiresAt: new Date(Date.now() - 1000) }))
      .rejects.toThrow(/expiry_required/);
  });

  it('refuses forged owners, foreign tenants, substituted responsibilities, and non-Shadowing subjects', async () => {
    await expect(grantDevelopmentAuthority(validGrant('da_product', 'da_resp', 'da_other')))
      .rejects.toThrow(/invalid_binding/);
    await expect(grantDevelopmentAuthority(validGrant('da_product', 'daf_resp', 'da_owner')))
      .rejects.toThrow(/invalid_binding/);
    // A support responsibility cannot be dressed up as development authority.
    await expect(grantDevelopmentAuthority(validGrant('da_product', 'da_support', 'da_owner')))
      .rejects.toThrow(/invalid_binding/);
    // And a foreign tenant's grant never appears in this product's authority.
    expect(await getCurrentDevelopmentAuthority('da_product', 'daf_resp')).toBeNull();
  });

  it('treats revoked and expired authority as simply absent', async () => {
    const consentId = await grantDevelopmentAuthority(validGrant('da_product', 'da_resp', 'da_owner'));
    expect(await getCurrentDevelopmentAuthority('da_product', 'da_resp')).not.toBeNull();

    await revokeDevelopmentAuthority('da_product', consentId, 'da_owner');
    // Revoking the newest grant must not silently fall back to an older one.
    await query("UPDATE autonomy_consents SET revoked_at=CURRENT_TIMESTAMP WHERE product_id='da_product' AND responsibility_id='da_resp'", []);
    expect(await getCurrentDevelopmentAuthority('da_product', 'da_resp')).toBeNull();

    const fresh = await grantDevelopmentAuthority(validGrant('da_product', 'da_resp', 'da_owner'));
    await query('UPDATE autonomy_consents SET expires_at=? WHERE id=?',
      [new Date(Date.now() - 1000).toISOString(), fresh]);
    expect(await getCurrentDevelopmentAuthority('da_product', 'da_resp')).toBeNull();
  });

  it('denies constitutional and escaping paths at plan time even when a prefix would allow them', () => {
    const authority: DevelopmentAuthority = {
      consentId: 'c', responsibilityId: 'da_resp', repository: 'Thmsnrtn/foundry',
      allowedPathPrefixes: ['docs/db/', 'src/'], changeClass: 'generated_artifact',
      requiredVerification: [CHECK], expiresAt: IN_ONE_HOUR().toISOString(),
    };
    expect(isPathWithinAuthority('docs/db/schema.snapshot.sql', authority)).toBe(true);
    expect(isPathWithinAuthority('./docs/db/schema.snapshot.sql', authority)).toBe(true);
    expect(isPathWithinAuthority('src/index.ts', authority)).toBe(true);

    // Granted by prefix, denied by the ring.
    expect(isPathWithinAuthority('src/db/migrations/121_new.sql', authority)).toBe(false);
    expect(isPathWithinAuthority('src/services/institution/responsibility.ts', authority)).toBe(false);
    expect(isPathWithinAuthority('src/services/outbound/gateway.ts', authority)).toBe(false);
    expect(isPathWithinAuthority('AGENTS.md', authority)).toBe(false);
    expect(isPathWithinAuthority('docs/foundry-institution/CONSTITUTION.md', authority)).toBe(false);
    expect(isPathWithinAuthority('scripts/ratchet.mjs', authority)).toBe(false);

    // Outside every granted prefix, and outright malformed.
    expect(isPathWithinAuthority('tests/unit/x.test.ts', authority)).toBe(false);
    expect(isPathWithinAuthority('src/../AGENTS.md', authority)).toBe(false);
    expect(isPathWithinAuthority('/etc/passwd', authority)).toBe(false);
    expect(isPathWithinAuthority('', authority)).toBe(false);
  });

  it('keeps the plan-time ring identical to the database ring', () => {
    // The database guard is authoritative; drift between the two would let a
    // path be refused in one place and permitted in the other.
    const sql = readFileSync(resolve(process.cwd(), 'src/db/migrations/120_development_authority.sql'), 'utf8');
    const declared = [...sql.matchAll(/"((?:src|docs|scripts|AGENTS)[^"]*)"/g)].map((m) => m[1]);
    expect([...new Set(declared)].sort()).toEqual([...CONSTITUTIONAL_PATHS].sort());
    for (const path of CONSTITUTIONAL_PATHS) {
      expect(isConstitutionalPath(path.endsWith('/') ? `${path}anything.ts` : path)).toBe(true);
    }
  });
});
