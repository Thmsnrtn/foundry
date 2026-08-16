process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import {
  decideDevelopmentDisposition, type DevelopmentDisposition,
} from '../../src/services/institution/development-disposition.js';

const CHECK = 'schema-snapshot-freshness';
const TARGET = 'docs/db/schema.snapshot.sql';

let counter = 0;

/** One isolated responsibility per case, so no fixture's evidence leaks into another. */
async function scenario(
  claims: Array<{ predicate: string; value: unknown; status?: 'known' | 'inferred' | 'unknown' | 'conflicting'; validUntil?: Date }>,
  productId = 'dd_product',
): Promise<string> {
  const responsibilityId = `dd_resp_${counter += 1}`;
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,'Keep the schema snapshot in sync','development','shadowing')`, [responsibilityId, productId]);
  for (const claim of claims) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate: claim.predicate,
      value: claim.status === 'unknown' ? undefined : claim.value,
      epistemicStatus: claim.status ?? 'known',
      confidence: claim.status === 'inferred' ? 0.7 : undefined,
      // Conflict must genuinely come from more than one source; the claim
      // ledger refuses a single-source conflict, and rightly so.
      evidenceRefs: claim.status === 'unknown' ? []
        : claim.status === 'conflicting'
          ? [{ kind: 'signal_event', id: `${productId}_sig` }, { kind: 'signal_event', id: `${productId}_sig2` }]
          : [{ kind: 'signal_event', id: `${productId}_sig` }],
      derivationMethod: 'fixture', observedAt: new Date(), validUntil: claim.validUntil,
    });
  }
  return responsibilityId;
}

const need = { predicate: 'development_need', value: { check: CHECK, summary: 'snapshot drifted' } };
const intended = {
  predicate: 'development_intended_content',
  value: { path: TARGET, content: '-- regenerated\n', changeClass: 'generated_artifact' },
};

const expectDisposition = async (responsibilityId: string, disposition: DevelopmentDisposition, productId = 'dd_product') => {
  const result = await decideDevelopmentDisposition(productId, responsibilityId);
  expect(result.disposition).toBe(disposition);
  return result;
};

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('dd_owner','dd_clerk','dd@example.com')", []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('dd_product','Owned Co','dd_owner'),('dd_foreign','Foreign Co','dd_owner')`, []);
  for (const productId of ['dd_product', 'dd_foreign']) {
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES (?,?,'repository','development_need_observed','medium','{}','Snapshot drifted'),
             (?,?,'repository','development_need_observed','medium','{}','A second, disagreeing report')`,
    [`${productId}_sig`, productId, `${productId}_sig2`, productId]);
  }
});

describe('knowing when not to code', () => {
  it('does nothing when no evidence describes a development need', async () => {
    const result = await expectDisposition(await scenario([]), 'do_nothing');
    expect(result.change).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it('investigates rather than guessing when the need is unknown or stale', async () => {
    await expectDisposition(await scenario([{ ...need, status: 'unknown' }]), 'investigate');
    await expectDisposition(
      await scenario([{ ...need, validUntil: new Date(Date.now() - 1000) }, intended]), 'investigate',
    );
    // The need is real, but nothing grounds what should actually differ.
    const bare = await expectDisposition(await scenario([need]), 'investigate');
    expect(bare.change).toBeNull();
    // A proposal too malformed to act on is also a reason to look, not to build.
    await expectDisposition(await scenario([
      need, { predicate: 'development_intended_content', value: { path: TARGET } },
    ]), 'investigate');
  });

  it('defers on conflict, on a blocker, and when more than one change is proposed', async () => {
    await expectDisposition(await scenario([{ ...need, status: 'conflicting' }, intended]), 'defer');
    await expectDisposition(await scenario([
      need, intended, { predicate: 'development_blocker', value: { reason: 'migration freeze in effect' } },
    ]), 'defer');
    await expectDisposition(await scenario([
      need, intended,
      { predicate: 'development_intended_content', value: { path: TARGET, content: '-- other\n', changeClass: 'generated_artifact' } },
    ]), 'defer');
  });

  it('prefers configuring or deleting over writing code', async () => {
    const configure = await expectDisposition(await scenario([
      need, intended, { predicate: 'development_alternative', value: { kind: 'configure' } },
    ]), 'configure');
    expect(configure.change).toBeNull();

    await expectDisposition(await scenario([
      need, intended, { predicate: 'development_alternative', value: { kind: 'existing_capability' } },
    ]), 'configure');

    const remove = await expectDisposition(await scenario([
      need, intended, { predicate: 'development_alternative', value: { kind: 'delete' } },
    ]), 'delete');
    expect(remove.change).toBeNull();
  });

  it('changes only when one current, grounded, well-formed change addresses the need', async () => {
    const result = await expectDisposition(await scenario([need, intended]), 'change');
    expect(result.change).toEqual({ path: TARGET, content: '-- regenerated\n', changeClass: 'generated_artifact' });
    expect(result.evidence).toHaveLength(2);
    expect(result.rationale).toMatch(/grounded/);
  });

  it('accepts inferred evidence but never invents a change of its own', async () => {
    const inferred = await expectDisposition(await scenario([
      { ...need, status: 'inferred' }, { ...intended, status: 'inferred' },
    ]), 'change');
    expect(inferred.change?.content).toBe('-- regenerated\n');
    // Every case above either supplies a change from evidence or returns none.
    for (const disposition of ['do_nothing', 'investigate', 'defer', 'configure', 'delete'] as const) {
      const responsibilityId = await scenario(
        disposition === 'do_nothing' ? []
          : disposition === 'investigate' ? [need]
            : disposition === 'defer' ? [{ ...need, status: 'conflicting' }]
              : [need, intended, { predicate: 'development_alternative', value: { kind: disposition === 'delete' ? 'delete' : 'configure' } }],
      );
      expect((await decideDevelopmentDisposition('dd_product', responsibilityId)).change).toBeNull();
    }
  });

  it('never reads another tenant evidence to justify a change', async () => {
    const responsibilityId = await scenario([need, intended], 'dd_foreign');
    // The same responsibility, asked about from the wrong product, has nothing.
    await expectDisposition(responsibilityId, 'do_nothing', 'dd_product');
    await expectDisposition(responsibilityId, 'change', 'dd_foreign');
  });

  it('is deterministic and costs nothing', async () => {
    const responsibilityId = await scenario([need, intended]);
    const first = await decideDevelopmentDisposition('dd_product', responsibilityId);
    const second = await decideDevelopmentDisposition('dd_product', responsibilityId);
    expect(second).toEqual(first);
    // Zero model calls: the module imports no AI client at all.
    const source = (await import('node:fs')).readFileSync(
      'src/services/institution/development-disposition.ts', 'utf8',
    );
    expect(source).not.toMatch(/openrouter|anthropic|callModel|generateText/i);
  });
});
