process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  availableObservationChannels, externalObservationEventType, recordExternalMetricObservations,
} from '../../src/services/institution/external-observation.js';
import {
  beginExternalMetricShadowing, getShadowableResponsibilities, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import {
  recordFounderEvidenceAnswer, selectFounderEvidenceQuestion,
} from '../../src/services/institution/founder-evidence.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';

// =============================================================================
// Shadowing against independently observed reality.
//
// Shadowing was the last rung with no honest supply: every observation Foundry
// could produce came from Foundry. The audit found the strongest existing
// external source already in production — `POST /ingest/:token`, a public
// token-authenticated endpoint outside tools post company metrics to. No new
// integration was created.
//
// Independence here is a property of provenance, not of plumbing. An
// observation is not independent because it arrived through a different
// function. These tests attack that claim from every direction the owner named.
// =============================================================================

const OWNER = 'xs_owner';
const STRANGER = 'xs_stranger';
const PRODUCT = 'xs_bakery';
const FOREIGN = 'xs_foreign';

async function countOf(sql: string, args: unknown[] = []): Promise<number> {
  return Number(((await query(sql, args)).rows[0] as Record<string, unknown>).n);
}

/** An outside system reported a reading yesterday, then again today. */
async function outsideReported(productId: string, field: string, previous: number, observed: number): Promise<void> {
  await query('DELETE FROM metric_snapshots WHERE product_id=?', [productId]);
  await query(
    `INSERT INTO metric_snapshots (id,product_id,snapshot_date,${field}) VALUES (?,?,date('now','-1 day'),?)`,
    [`${productId}_${field}_prev_${previous}`.slice(0, 60), productId, previous]);
  await recordExternalMetricObservations({
    productId, origin: 'ingest_endpoint', readings: [{ field, observedValue: observed }],
  });
}

/** A company driven the whole way to Understood through production paths. */
async function understoodResponsibility(productId: string): Promise<string> {
  const reported = await reportCompanyObligation({
    productId, founderId: OWNER, obligationKind: 'customer_commitment',
    what: 'Answer wholesale customers about their standing orders',
  });
  const responsibilityId = reported!.responsibility!.id;
  for (let i = 0; i < 20; i++) {
    const question = await selectFounderEvidenceQuestion(productId);
    if (!question) break;
    await recordFounderEvidenceAnswer({
      requestId: question.requestId, founderId: OWNER, statement: `How the bakery handles this (${i})`,
    });
  }
  await earnResponsibilityUnderstanding(productId, responsibilityId);
  return responsibilityId;
}

let responsibilityId: string;
let expectationId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES
    (?,'xs_clerk','owner@example.com'),(?,'xs_stranger_clerk','stranger@example.com')`, [OWNER, STRANGER]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    (?,'Halden Bread Supply',?),(?,'Foreign Co',?)`, [PRODUCT, OWNER, FOREIGN, STRANGER]);
});

describe('Shadowing against independently observed reality', () => {
  it('will not enter Shadowing on a channel that has never produced evidence', async () => {
    responsibilityId = await understoodResponsibility(PRODUCT);
    expect(await availableObservationChannels(PRODUCT)).toEqual([]);
    expect(await getShadowableResponsibilities(PRODUCT)).toEqual([]);

    // Entering the rung here would be a promise that observation will arrive,
    // not proof that it does.
    expect(await beginExternalMetricShadowing({
      productId: PRODUCT, responsibilityId, founderId: OWNER,
      field: 'support_volume_7d', direction: 'fell',
    })).toBeNull();
    expect(await countOf(
      'SELECT COUNT(*) n FROM responsibility_shadow_expectations WHERE product_id=?', [PRODUCT])).toBe(0);
  });

  it('records what an outside system reported, and nothing it did not', async () => {
    await outsideReported(PRODUCT, 'support_volume_7d', 40, 12);
    const observation = (await query(
      `SELECT event_type,payload_json FROM signal_events
        WHERE product_id=? AND source='external_metric_ingest'`, [PRODUCT])).rows[0] as Record<string, unknown>;
    expect(String(observation.event_type)).toBe('external_metric:support_volume_7d:fell');

    // Arithmetic on two reported numbers, and no interpretation of it. Turning
    // "support volume fell" into "support is being handled" is precisely the
    // inference the expectation exists to test.
    const payload = JSON.parse(String(observation.payload_json)) as Record<string, unknown>;
    expect(payload).toMatchObject({ origin: 'ingest_endpoint', field: 'support_volume_7d', direction: 'fell' });
    expect(Object.keys(payload).sort())
      .toEqual(['direction', 'field', 'observed_value', 'origin', 'previous_value']);
    expect(await availableObservationChannels(PRODUCT)).toEqual(['support_volume_7d']);
  });

  it('carries an understood responsibility onto the rung and compares against reality', async () => {
    const shadowable = await getShadowableResponsibilities(PRODUCT);
    expect(shadowable).toHaveLength(1);
    expect(shadowable[0].channels[0].label).not.toMatch(/_|snapshot|column/);

    // The reading that proved the channel exists happened before Foundry said
    // anything, which is the real order of events. Place it there so the
    // comparison window is the honest one.
    await query(
      `UPDATE signal_events SET created_at=datetime('now','-1 day')
        WHERE product_id=? AND source='external_metric_ingest'`, [PRODUCT]);

    expect(await beginExternalMetricShadowing({
      productId: PRODUCT, responsibilityId, founderId: OWNER,
      field: 'support_volume_7d', direction: 'fell',
    })).toMatchObject({ state: 'shadowing', authorityRef: null });

    expectationId = String(((await query(
      'SELECT id FROM responsibility_shadow_expectations WHERE product_id=?', [PRODUCT]))
      .rows[0] as Record<string, unknown>).id);

    // No reading has arrived since the expectation. Absence is neither success
    // nor failure.
    expect(await resolveExternalMetricShadowing(PRODUCT, expectationId))
      .toMatchObject({ classification: 'unresolved', observationsConsidered: 0, learnedClaimId: null });

    // An outside system reports again, after the expectation.
    await query("UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);
    await outsideReported(PRODUCT, 'support_volume_7d', 12, 5);

    const resolution = await resolveExternalMetricShadowing(PRODUCT, expectationId);
    expect(resolution).toMatchObject({ classification: 'matched', observationsConsidered: 1 });

    // What was learned cites the outside readings themselves.
    const learned = (await query('SELECT subject,predicate,evidence_refs_json FROM reconstruction_claims WHERE id=?',
      [resolution.learnedClaimId!])).rows[0] as Record<string, unknown>;
    expect(learned).toMatchObject({ subject: `responsibility:${responsibilityId}`, predicate: 'shadow_comparison' });
    const refs = JSON.parse(String(learned.evidence_refs_json)) as Array<{ kind: string; id: string }>;
    expect(refs.every((r) => r.kind === 'signal_event')).toBe(true);
  });

  it('watching authorises nothing', async () => {
    expect(await countOf('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [PRODUCT])).toBe(0);
    expect(await countOf('SELECT COUNT(*) n FROM action_executions WHERE product_id=?', [PRODUCT])).toBe(0);
    expect((await query('SELECT state,authority_ref FROM institutional_responsibilities WHERE id=?', [responsibilityId]))
      .rows[0]).toMatchObject({ state: 'shadowing', authority_ref: null });
  });

  it('lets a deviation dominate a favourable reading', async () => {
    // A channel that reported both the expected movement and its opposite has
    // not confirmed the expectation. A good result must not bury a bad one.
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
      VALUES ('xs_rose',?,'external_metric_ingest','external_metric:support_volume_7d:rose','low',?,'Rose')`,
    [PRODUCT, JSON.stringify({
      origin: 'ingest_endpoint', field: 'support_volume_7d', direction: 'rose',
      observed_value: 30, previous_value: 5,
    })]);
    expect(await resolveExternalMetricShadowing(PRODUCT, expectationId))
      .toMatchObject({ classification: 'deviated' });
  });

  describe('attacks on independence', () => {
    const base = {
      origin: 'ingest_endpoint', field: 'support_volume_7d', direction: 'fell',
      observed_value: 1, previous_value: 2,
    };
    const insertObservation = (id: string, productId: string, payload: Record<string, unknown>, eventType?: string) =>
      query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
        VALUES (?,?,'external_metric_ingest',?,'low',?,'Attack')`,
      [id, productId, eventType ?? externalObservationEventType(
        String(payload.field ?? 'support_volume_7d'), payload.direction as 'fell'), JSON.stringify(payload)]);

    it('refuses an observation that names what it will be compared against', async () => {
      // The expectation itself, a claim derived from it, the judgment, and a
      // plan echoing it are all the same failure: an observer that can see the
      // prediction makes a fabricated match indistinguishable from a real one.
      for (const echo of [
        { expectation_id: expectationId }, { responsibility_id: responsibilityId },
        { judgment_id: 'anything' }, { claim_id: 'anything' },
        { expected_event_type: 'external_metric:support_volume_7d:fell' },
      ]) {
        await expect(insertObservation(`xs_echo_${Object.keys(echo)[0]}`, PRODUCT, { ...base, ...echo }))
          .rejects.toThrow(/circular_grounding/);
      }
    });

    it('refuses a caller-invented source, field, direction, or mislabelled event', async () => {
      await expect(insertObservation('xs_badfield', PRODUCT, { ...base, field: 'vibes' }))
        .rejects.toThrow(/field_invalid/);
      await expect(insertObservation('xs_baddir', PRODUCT, { ...base, direction: 'improved' }))
        .rejects.toThrow(/direction_invalid/);
      await expect(insertObservation('xs_noorigin', PRODUCT, { ...base, origin: '' }))
        .rejects.toThrow(/payload_invalid/);
      await expect(insertObservation('xs_novalues', PRODUCT,
        { origin: 'x', field: 'support_volume_7d', direction: 'fell' }))
        .rejects.toThrow(/payload_invalid/);
      // A label that disagrees with the reading it claims to describe.
      await expect(insertObservation('xs_mislabel', PRODUCT, base, 'external_metric:support_volume_7d:rose'))
        .rejects.toThrow(/event_type_mismatch/);
    });

    it('refuses an ordinary signal dressed up as an external observation', async () => {
      // The founder's own statement of the expectation is real evidence, and it
      // is not an outside reading. Comparing against it would be Foundry
      // marking its own homework.
      const founderStatement = String(((await query(
        `SELECT id FROM signal_events WHERE product_id=? AND source='founder_assertion_structured'`, [PRODUCT]))
        .rows[0] as Record<string, unknown>).id);
      await expect(query(
        `INSERT INTO responsibility_shadow_comparisons (id,expectation_id,product_id,observation_ref,classification)
         VALUES ('xs_selfmark',?,?,?,'matched')`,
        [expectationId, PRODUCT, `signal_event:${founderStatement}`],
      // Either refusal is correct and both are in force. Migration 191 added a
      // general floor — the observation must come from the channel the
      // expectation named — which fires before migration 127's prefix-keyed
      // guard on the same attack. 127 is kept: it also refuses an observation
      // that predates the expectation, which the general rule does not test.
      )).rejects.toThrow(/observation_not_independent|observation_channel_not_the_nominated_one/);
    });

    it('refuses an observation that predates the expectation it resolves', async () => {
      // The very first reading — the one that proved the channel exists — was
      // recorded before the expectation and cannot be news about it.
      const early = String(((await query(
        `SELECT id FROM signal_events WHERE product_id=? AND source='external_metric_ingest'
          ORDER BY created_at,id LIMIT 1`, [PRODUCT])).rows[0] as Record<string, unknown>).id);
      await query("UPDATE signal_events SET created_at=datetime('now','-1 day') WHERE id=?", [early]);
      await expect(query(
        `INSERT INTO responsibility_shadow_comparisons (id,expectation_id,product_id,observation_ref,classification)
         VALUES ('xs_early',?,?,?,'matched')`,
        [expectationId, PRODUCT, `signal_event:${early}`],
      )).rejects.toThrow(/observation_predates_expectation/);
    });

    it('refuses a cross-tenant observation and a foreign responsibility', async () => {
      await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
        VALUES ('xs_foreign_obs',?,'external_metric_ingest','external_metric:support_volume_7d:fell','low',?,'Foreign')`,
      [FOREIGN, JSON.stringify(base)]);
      await expect(query(
        `INSERT INTO responsibility_shadow_comparisons (id,expectation_id,product_id,observation_ref,classification)
         VALUES ('xs_cross',?,?,'signal_event:xs_foreign_obs','matched')`,
        [expectationId, PRODUCT],
      )).rejects.toThrow(/observation_not_independent|observation_channel_not_the_nominated_one/);

      // And a stranger cannot start Foundry watching this company.
      expect(await beginExternalMetricShadowing({
        productId: PRODUCT, responsibilityId, founderId: STRANGER,
        field: 'support_volume_7d', direction: 'fell',
      })).toBeNull();
    });

    it('treats a replayed reading as the same observation, not new evidence', async () => {
      const before = await countOf(
        "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='external_metric_ingest'", [PRODUCT]);
      // The same post arriving three times — a retry, a duplicated webhook.
      for (let i = 0; i < 3; i++) {
        await recordExternalMetricObservations({
          productId: PRODUCT, origin: 'ingest_endpoint',
          readings: [{ field: 'support_volume_7d', observedValue: 5 }],
        });
      }
      expect(await countOf(
        "SELECT COUNT(*) n FROM signal_events WHERE product_id=? AND source='external_metric_ingest'", [PRODUCT]))
        .toBe(before);
    });

    it('records nothing when there is no prior reading to compare against', async () => {
      // A first-ever reading is a value, not a movement. Reporting a direction
      // would mean inventing the number it moved from.
      const fresh = 'xs_fresh';
      await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [fresh, 'Fresh Co', OWNER]);
      expect(await recordExternalMetricObservations({
        productId: fresh, origin: 'ingest_endpoint', readings: [{ field: 'active_users', observedValue: 10 }],
      })).toEqual([]);
      expect(await availableObservationChannels(fresh)).toEqual([]);
    });
  });

  it('is production-reachable — an outside caller actually writes observations', () => {
    // "Code exists" is not "a production caller exists". Two sessions running,
    // the worst defect in this system was something built, reachable, and never
    // called; this asserts the writer directly.
    const src = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = resolve(dir, e);
      return statSync(p).isDirectory() ? src(p) : p.endsWith('.ts') ? [p] : [];
    });
    const callers = src(resolve(process.cwd(), 'src'))
      .filter((f) => !f.endsWith('services/institution/external-observation.ts'))
      .filter((f) => /recordExternalMetricObservations/.test(readFileSync(f, 'utf8')));
    expect(callers.map((f) => f.replace(process.cwd() + '/', '')))
      .toContain('src/routes/ingest/index.ts');
  });
});
