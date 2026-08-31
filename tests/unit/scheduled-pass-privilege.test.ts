process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { JOB_REGISTRY } from '../../src/jobs/index.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { requiredUnderstandingFacts } from '../../src/services/institution/responsibility-understanding.js';

// =============================================================================
// The scheduled institutional pass is an ORCHESTRATOR, not an authority.
//
// It now earns Understanding when evidence permits and resolves open Shadowing
// expectations when independent observations permit. Both are consequential, so
// the question worth asking is whether running as a background job buys any
// epistemic privilege at all.
//
// It must not. A job is a caller like any other: it goes through the same
// canonical functions, hits the same guards, and is refused for the same
// reasons. These tests prove that behaviourally — by running the real job
// against companies engineered to be refused — and structurally, by proving the
// job writes no institutional state itself.
// =============================================================================

const OWNER = 'sp_owner';
const P = 'sp_co';
const FOREIGN = 'sp_foreign';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

async function responsibility(id: string, productId = P, capability = 'customer_support'): Promise<void> {
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,?,?,'visible',?)`,
    [id, productId, `Responsibility ${id}`, capability, `signal_event:${productId}_sig:${id}`],
  );
}

/** Ground every required fact for a responsibility, with per-fact overrides. */
async function ground(
  id: string, capability: string,
  overrides: Partial<Record<string, 'stale' | 'conflicting' | 'missing'>> = {},
): Promise<void> {
  for (const fact of requiredUnderstandingFacts(capability)) {
    const mode = overrides[fact];
    if (mode === 'missing') continue;
    if (mode === 'conflicting') {
      await recordReconstructionClaim({
        productId: P, subject: `responsibility:${id}`, predicate: fact,
        value: { statement: 'two sources disagree' }, epistemicStatus: 'conflicting',
        evidenceRefs: [{ kind: 'signal_event', id: `${P}_sig` }, { kind: 'signal_event', id: `${P}_sig2` }],
        derivationMethod: 'independent disagreement', observedAt: new Date(),
      });
      continue;
    }
    await recordReconstructionClaim({
      productId: P, subject: `responsibility:${id}`, predicate: fact,
      value: { statement: `about ${fact}` }, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${P}_sig` }],
      derivationMethod: 'authenticated founder assertion',
      observedAt: new Date('2026-01-01'),
      ...(mode === 'stale' ? { validUntil: new Date('2026-01-02') } : {}),
    });
  }
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'sp_clerk','owner@example.com'),('sp_other','sp_other_clerk','other@example.com')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Scheduled Co',?),(?,'Foreign Co','sp_other')`, [P, OWNER, FOREIGN]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','Evidence'),
    (?,?,'company_observation_baseline','company_observation_baseline:second','low','{}','Second source'),
    (?,?,'company_observation_baseline','company_observation_baseline:observed','low','{}','Foreign evidence')`,
  [`${P}_sig`, P, `${P}_sig2`, P, `${FOREIGN}_sig`, FOREIGN]);

  // Fully grounded — the control. If this does not advance, the refusals below
  // prove nothing, because an inert job refuses everything.
  await responsibility('sp_complete');
  await ground('sp_complete', 'customer_support');

  // Each of these is engineered to be refused, for a different reason.
  await responsibility('sp_missing');
  await ground('sp_missing', 'customer_support', { purpose: 'missing' });

  await responsibility('sp_stale');
  await ground('sp_stale', 'customer_support', { risks: 'stale' });

  await responsibility('sp_conflicting');
  await ground('sp_conflicting', 'customer_support', { dependencies: 'conflicting' });

  // Grounded only by another company's evidence about the same subject string.
  await responsibility('sp_foreign_evidence');
  for (const fact of requiredUnderstandingFacts('customer_support')) {
    await recordReconstructionClaim({
      productId: FOREIGN, subject: 'responsibility:sp_foreign_evidence', predicate: fact,
      value: { statement: 'another company said so' }, epistemicStatus: 'known',
      evidenceRefs: [{ kind: 'signal_event', id: `${FOREIGN}_sig` }],
      derivationMethod: 'foreign', observedAt: new Date(),
    });
  }

  // An open expectation with no independent observation at all.
  await responsibility('sp_watching');
  await ground('sp_watching', 'customer_support');
  await query(
    `INSERT INTO responsibility_transitions (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
     VALUES ('sp_t1','sp_watching','visible','understood',?,'grounded','test')`, [`signal_event:${P}_sig`]);
  const claimId = await recordReconstructionClaim({
    productId: P, subject: 'responsibility:sp_watching', predicate: 'shadow_expectation',
    value: { field: 'support_volume_7d', direction: 'fell' }, epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: `${P}_sig` }],
    derivationMethod: 'authenticated founder expectation', observedAt: new Date(),
  });
  await query(
    // An `external_metric:%` expectation, so the channel is the one migration
    // 127's trigger hardcodes. Named here rather than implied, which is what
    // migration 191 requires of every expectation.
    `INSERT INTO responsibility_shadow_expectations
       (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,
        observation_source_evidence_ref,observation_source_kind)
     VALUES ('sp_expect','sp_watching',?, 'external_metric:support_volume_7d:fell', ?, ?,
             'external_metric_ingest')`,
    [P, `reconstruction_claim:${claimId}`, `signal_event:${P}_sig`]);
  await query(
    `INSERT INTO responsibility_transitions (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
     VALUES ('sp_t2','sp_watching','understood','shadowing',?,'watching','test')`, [`signal_event:${P}_sig`]);
});

describe('the scheduled institutional pass has no privilege', () => {
  it('writes no institutional state of its own', () => {
    // Structural: the job body may read, and may call canonical services. If it
    // ever writes an institutional row directly it has stopped being an
    // orchestrator and become a second, unguarded path to maturity.
    const source = readFileSync(resolve(process.cwd(), 'src/jobs/index.ts'), 'utf8');
    const job = source.slice(source.indexOf('institutional_judgment_tick: {'));
    const body = job.slice(0, job.indexOf('\n    schedule:'));
    const writes = [...body.matchAll(/(INSERT\s+INTO|UPDATE)\s+([a-z_]+)/gi)]
      .map((m) => m[2].toLowerCase())
      .filter((table) => [
        'institutional_responsibilities', 'responsibility_transitions', 'autonomy_consents',
        'reconstruction_claims', 'outbound_actions', 'responsibility_shadow_comparisons',
        'responsibility_shadow_expectations', 'signal_events',
      ].includes(table));
    expect(writes,
      `The scheduled pass writes institutional state directly: ${writes.join(', ')}. ` +
      'It must go through the same canonical functions as every other caller.').toEqual([]);
  });

  it('advances only what the evidence actually supports', async () => {
    const before = {
      consents: await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P]),
      actions: await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [P]),
    };
    await JOB_REGISTRY.institutional_judgment_tick.fn();

    const state = async (id: string): Promise<string> => String(((await query(
      'SELECT state FROM institutional_responsibilities WHERE id=?', [id]))
      .rows[0] as Record<string, unknown>).state);

    // The control advanced — so the refusals below are refusals, not inertia.
    expect(await state('sp_complete')).toBe('understood');

    // Every engineered refusal held, each for its own reason.
    expect(await state('sp_missing')).toBe('visible');        // a critical fact is absent
    expect(await state('sp_stale')).toBe('visible');          // an expired fact is not current
    expect(await state('sp_conflicting')).toBe('visible');    // disagreement is not resolved by ignoring it
    expect(await state('sp_foreign_evidence')).toBe('visible'); // another company's evidence is not this one's

    // Silence is not evidence: an expectation with no independent observation
    // produces no comparison at all, rather than a favourable one.
    expect(await countOf('SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE product_id=?', [P])).toBe(0);
    expect(await state('sp_watching')).toBe('shadowing');

    // A background job creates no authority and executes nothing.
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).toBe(before.consents);
    expect(await countOf('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?', [P])).toBe(before.actions);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [P])).toBe(0);
    expect(await countOf(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND state='assisting'", [P])).toBe(0);
  });

  it('manufactures no provenance for what it does advance', async () => {
    // The transition it wrote cites a real claim of this product — the job did
    // not author evidence to justify its own conclusion.
    const transition = (await query(
      `SELECT evidence_ref,actor_ref FROM responsibility_transitions
        WHERE responsibility_id='sp_complete' AND to_state='understood'`, []))
      .rows[0] as Record<string, unknown>;
    const claimId = String(transition.evidence_ref).replace('reconstruction_claim:', '');
    expect(await countOf('SELECT COUNT(*) n FROM reconstruction_claims WHERE id=? AND product_id=?',
      [claimId, P])).toBe(1);
    // And it is attributed to the institutional verifier, not to "the cron".
    expect(String(transition.actor_ref)).toContain('institution:');
  });

  it('is idempotent — running again advances nothing further', async () => {
    const before = await countOf('SELECT COUNT(*) n FROM responsibility_transitions', []);
    await JOB_REGISTRY.institutional_judgment_tick.fn();
    expect(await countOf('SELECT COUNT(*) n FROM responsibility_transitions', [])).toBe(before);
  });
});
