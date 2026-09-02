process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE CHANNEL WE SAID WE WOULD WATCH.
//
// Entering Shadowing writes a transition whose reason is "A current independent
// observation channel can test a bounded expectation." That sentence is the
// entire justification for the state. The rule it states was enforced three
// times, and each of the three keyed on the SHAPE OF THE EXPECTATION rather
// than on the channel:
//
//   migration 119   trigger matching `expected_event_type LIKE
//                   'development_verified:%'`, hardcoding the source
//   migration 127   trigger matching `expected_event_type LIKE
//                   'external_metric:%'`, hardcoding the source
//   both callers    each filtering its own observation query
//
// `beginResponsibilityShadowing` accepts ANY `expectedEventType`. So a third
// kind of shadowing got the reason in its transition log and NO guard — not a
// weaker one, none, because neither LIKE would match. And the suite itself held
// six such setups: 'support_capacity_restored', 'support_restored',
// 'deploy_succeeded', 'company_observation_baseline:observed'. Not one was
// covered by either trigger.
//
// HOW THE OBVIOUS FIX WAS WRONG, which is the part worth carrying. The natural
// general rule is "the observation must come from the same source as the signal
// in `observation_source_evidence_ref`". That column does not mean one thing.
// In external shadowing it holds a signal FROM the ingest channel. In
// development shadowing it holds a `repository` signal recording the NEED — the
// verification has not happened yet, so there is no signal from the observing
// channel to point at. A trigger built on source equality refused every
// development comparison. The suite said so within one run; the reading was
// checked against the data and replaced rather than argued with.
//
// So the channel is named directly. `observation_source_kind` is the
// `signal_events.source` that may resolve the expectation — exactly what the
// two triggers hardcode, moved to where a third caller cannot avoid supplying
// it.
// =============================================================================

const P = 'ch_product';
const OWNER = 'ch_owner';
let claimId: string;
let lastResponsibility = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [OWNER, 'ch_clerk', 'ch@example.com']);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [P, 'Channel Co', OWNER]);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
       ('ch_channel',?,'support','support_queue_observed','low','{}','Channel available'),
       ('ch_right',?,'support','support_capacity_restored','low','{}','A human restored capacity'),
       ('ch_wrong',?,'manual','support_capacity_restored','low','{}','Self-authored pass')`,
    [P, P, P]);

  // A real claim: migration 111 requires the expectation's evidence to be a
  // live reconstruction claim with at least one evidence ref.
  const { recordReconstructionClaim } =
    await import('../../src/services/institution/reconstruction.js');
  claimId = await recordReconstructionClaim({
    productId: P, subject: 'responsibility:ch_resp', predicate: 'expected_observed_event',
    value: 'support_capacity_restored', epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: 'ch_channel' }],
    derivationMethod: 'bounded expectation', observedAt: new Date(),
  });
});

/**
 * A fresh responsibility per case. State changes are refused without a recorded
 * transition — `responsibility_state:no_transition` — which is the institution
 * insisting that a state has a reason, so the fixture writes the transitions
 * rather than working around them.
 */
async function expectation(kind: string | null): Promise<string> {
  const respId = `ch_r_${nanoid(6)}`;
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
     VALUES (?,?,'Answer the support queue','customer_support','understood')`, [respId, P]);
  lastResponsibility = respId;
  const id = nanoid();
  await query(
    `INSERT INTO responsibility_shadow_expectations
       (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,
        observation_source_evidence_ref,observation_source_kind)
     VALUES (?,?,?,'support_capacity_restored',?,
             'signal_event:ch_channel',?)`,
    [id, respId, P, `reconstruction_claim:${claimId}`, kind]);
  return id;
}

async function compare(expectationId: string, observation: string): Promise<void> {
  await query(
    `INSERT INTO responsibility_transitions
       (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
     VALUES (?,?,'understood','shadowing','signal_event:ch_channel','test fixture','test')`,
    [nanoid(), lastResponsibility]);
  await query(
    `INSERT INTO responsibility_shadow_comparisons
       (id,expectation_id,product_id,observation_ref,classification)
     VALUES (?,?,?,?,'matched')`,
    [nanoid(), expectationId, P, `signal_event:${observation}`]);
}

describe('an expectation must name the channel that can resolve it', () => {
  it('refuses one that names none', async () => {
    await expect(expectation(null)).rejects.toThrow(/expectation_names_no_observation_channel/);
  });

  it('refuses one that names an empty channel', async () => {
    await expect(expectation('   ')).rejects.toThrow(/expectation_names_no_observation_channel/);
  });

  it('accepts one that names a channel', async () => {
    await expect(expectation('support')).resolves.toBeTypeOf('string');
  });
});

describe('the observation must come from that channel', () => {
  it('accepts one that does', async () => {
    const id = await expectation('support');
    await expect(compare(id, 'ch_right')).resolves.toBeUndefined();
  });

  it('refuses one that does not, whatever its event type says', async () => {
    const id = await expectation('support');
    // 'ch_wrong' carries the RIGHT event_type from the WRONG source. Before
    // this, an expectation of a kind neither trigger matched would have
    // accepted it.
    await expect(compare(id, 'ch_wrong'))
      .rejects.toThrow(/observation_channel_not_the_nominated_one/);
  });

  it('refuses an observation from another company', async () => {
    // Migration 111's own `observation_invalid` also refuses this; both are in
    // force and either message is correct. Asserted here so the cross-tenant
    // case is covered by this file too rather than assumed from elsewhere.
    await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
      ['ch_other_owner', 'ch_other', 'other@example.com']);
    await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)',
      ['ch_other_product', 'Other', 'ch_other_owner']);
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ch_foreign','ch_other_product','support','support_capacity_restored','low','{}','Foreign')`);

    const id = await expectation('support');
    await expect(compare(id, 'ch_foreign'))
      .rejects.toThrow(/observation_invalid|observation_channel_not_the_nominated_one/);
  });
});

describe('the guards it was built beneath are still there', () => {
  // Three assertions in the shadowing suites had to widen to accept either
  // refusal, because the general floor fires first on the same attacks. That
  // would let the specific triggers be deleted without a single test noticing,
  // so their existence is asserted directly.
  it('migration 119 and 127 triggers still exist', async () => {
    const names = ((await query(
      "SELECT name FROM sqlite_master WHERE type='trigger'")).rows as unknown as
      Array<Record<string, unknown>>).map((r) => String(r.name));
    expect(names).toContain('development_shadow_observation_independence_guard');
    expect(names).toContain('external_shadow_observation_independence_guard');
    expect(names).toContain('shadow_observation_matches_nominated_channel');
    expect(names).toContain('shadow_expectation_names_its_channel');
  });

  it('127 still refuses an observation that predates its expectation', () => {
    // The one check the general rule does not make, which is why 127 stays.
    const mig = readFileSync('src/db/migrations/127_external_metric_observations.sql', 'utf8');
    expect(mig).toMatch(/observation_predates_expectation/);
  });
});

describe('the callers state their channel rather than implying it', () => {
  it('both production callers name one', () => {
    // MIGRATION 223 GAVE EXTERNAL SHADOWING TWO CHANNELS, not two rules: a real
    // company's expectation is resolved by the world's readings, a reference
    // company's by the reference world's. The caller still NAMES the channel —
    // both of them, as literals, chosen from a column the caller cannot set —
    // which is the whole point of this rule. Nothing is implied.
    const external = readFileSync('src/services/institution/external-shadowing.ts', 'utf8');
    expect(external).toMatch(/observationSourceKind: reality === 'reference'/);
    // THREE CHANNELS SINCE MIGRATION 227 — the world's, a provider's test
    // mode, and the reference world's — and the caller still names all of
    // them as literals, chosen from state it cannot set. Nothing is implied.
    expect(external).toMatch(/'reference_metric_ingest'/);
    expect(external).toMatch(/'sandbox_metric_ingest' : 'external_metric_ingest'/);
    expect(readFileSync('src/services/institution/development-shadowing.ts', 'utf8'))
      .toMatch(/observationSourceKind: 'development_verification'/);
  });

  it('and development names the channel, not the source of the signal it cites', () => {
    // `observation_source_evidence_ref` there is a `repository` signal about the
    // NEED. Deriving the rule from it refused every development comparison.
    const src = readFileSync('src/services/institution/development-shadowing.ts', 'utf8');
    expect(src).toMatch(/not the source of the nominated signal/);
  });
});

describe('the founder is told where Foundry was watching', () => {
  it('the exceptions carry the channel and the evidence it existed', async () => {
    const id = await expectation('support');
    await query(
      `INSERT INTO responsibility_transitions
         (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
       VALUES (?,?,'understood','shadowing','signal_event:ch_channel','test fixture','test')`,
      [nanoid(), lastResponsibility]);
    await query(
      `INSERT INTO responsibility_shadow_comparisons
         (id,expectation_id,product_id,observation_ref,classification)
       VALUES (?,?,?,'signal_event:ch_right','deviated')`, [nanoid(), id, P]);

    const { getMaterialShadowingExceptions } =
      await import('../../src/services/institution/responsibility-shadowing.js');
    const rows = await getMaterialShadowingExceptions(P);
    const row = rows.find((r) => r.classification === 'deviated')!;
    expect(row.observationChannel).toBe('support');
    expect(row.channelEvidence, 'the reason Shadowing was allowed to begin at all')
      .toBe('signal_event:ch_channel');
  });

  it('and the column that carried that reason has left the write-only baseline', () => {
    expect(readFileSync('docs/db/write-only-columns-baseline.txt', 'utf8'))
      .not.toMatch(/observation_source_evidence_ref/);
  });
});
