process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginExternalMetricShadowing, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  recordCompanyObservations, registerObservationChannel,
} from '../../src/services/institution/company-observation.js';
import {
  grantAssistingAuthority, revokeAssistingAuthority,
} from '../../src/services/institution/assisting-admission.js';
import {
  planResponsibilityNotice, proposeResponsibilityNotice,
} from '../../src/services/institution/responsibility-notice.js';
import {
  RESPONSIBILITY_NOTICE_SCOPE, executeAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';

// =============================================================================
// A dance school, end to end.
//
//   owner report → Visible → Understood → Shadowing → resolved comparison
//     → exact bounded grant → Assisting → founder writes a notice
//       → plan → revalidate → governed send → receipt → outcome UNRESOLVED
//
// Every earlier test stopped at Shadowing, because the effect boundary named
// `customer_support`. This is the first time a company that is not doing
// customer support crosses the whole thing, and it is carried entirely by
// ordinary machinery: no kernel branch knows what a dance class is, and nothing
// here is a fixture standing in for a step that does not exist.
//
// What must remain true at the end: a provider accepting an email is not a
// teacher turning up on Saturday.
// =============================================================================

const P = 'ucv_dance';
const OWNER = 'ucv_owner';
const CHANNEL = 'classes_taught_weekly';

let responsibilityId: string;
let consentId: string;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ucv_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Fold Street Dance','${OWNER}')`, []);
});

describe('an unfamiliar company, carried the whole way', () => {
  it('is recognised from what the owner says has to happen', async () => {
    const reported = await reportCompanyObligation({
      productId: P, founderId: OWNER, obligationKind: 'recurring_work',
      what: 'Every timetabled class has a teacher and a room',
    });
    responsibilityId = reported!.responsibility!.id;
    expect(reported!.responsibility).toMatchObject({ state: 'visible', capability: 'operations' });
    expect(reported!.responsibility!.authorityRef).toBeNull();
  });

  it('is understood from the owner\'s own description of the business', async () => {
    const signalId = String(((await query(
      'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibilityId],
    )).rows[0] as Record<string, unknown>).d).replace('signal_event:', '');
    for (const [predicate, value] of Object.entries({
      purpose: 'Nobody turns up to a class that is not running',
      desired_outcome: 'The timetable and the week agree',
      success_conditions: 'Every timetabled class ran with a teacher present',
      operating_constraints: 'Four teachers, two studios, term dates fixed a year ahead',
      dependencies: 'Teacher availability and the studio lease',
      risks: 'A cancelled class loses the family, not just the fee',
      systems: 'The wall timetable and the class register',
      current_carrier: 'The studio manager rings round on Sunday evening',
      failure_modes: 'A teacher is ill and no cover is found before the class starts',
    })) {
      await recordReconstructionClaim({
        productId: P, subject: `responsibility:${responsibilityId}`, predicate, value,
        epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
        derivationMethod: 'the owner described how the school works', observedAt: new Date(),
      });
    }
    expect(await earnResponsibilityUnderstanding(P, responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });
  });

  it('is watched against a quantity the school itself counts', async () => {
    await registerObservationChannel({
      productId: P, founderId: OWNER, channelKey: CHANNEL,
      label: 'Classes actually taught', unit: 'classes',
    });
    for (const value of [38, 41]) {
      await recordCompanyObservations({
        productId: P, origin: 'studio_register', readings: [{ channelKey: CHANNEL, observedValue: value }],
      });
    }
    const shadowing = await beginExternalMetricShadowing({
      productId: P, responsibilityId, founderId: OWNER, field: CHANNEL, direction: 'rose',
    });
    expect(shadowing).toMatchObject({ state: 'shadowing', authorityRef: null });

    const expectationId = String(((await query(
      'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=? ORDER BY rowid DESC LIMIT 1',
      [responsibilityId])).rows[0] as Record<string, unknown>).id);
    await query(
      "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
      [expectationId]);
    await recordCompanyObservations({
      productId: P, origin: 'studio_register', readings: [{ channelKey: CHANNEL, observedValue: 46 }],
    });
    expect(await resolveExternalMetricShadowing(P, expectationId))
      .toMatchObject({ classification: 'matched' });
  });

  it('is helped only after the owner grants exact, expiring, revocable authority', async () => {
    // The ordinary grant path — the same call The Letter makes. It derives the
    // exact scope from the responsibility's capability, so `operations` gets a
    // notice grant and nothing wider.
    const granted = await grantAssistingAuthority({
      productId: P, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(granted, 'an operations responsibility must be grantable').not.toBeNull();
    consentId = granted!.consentId;
    expect(granted!.admitted).toBe(true);

    const consent = (await query(
      'SELECT capability,allowed_scope_json,consequence_boundary,revoked_at FROM autonomy_consents WHERE id=?',
      [consentId])).rows[0] as Record<string, unknown>;
    expect(consent).toMatchObject({ capability: 'operations', consequence_boundary: 'low', revoked_at: null });
    expect(JSON.parse(String(consent.allowed_scope_json))).toEqual([RESPONSIBILITY_NOTICE_SCOPE]);

    const row = (await query(
      'SELECT state,authority_ref FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0];
    expect(row).toMatchObject({ state: 'assisting', authority_ref: `autonomy_consent:${consentId}` });
  });

  it('carries the owner\'s own words across the governed boundary', async () => {
    const written = await proposeResponsibilityNotice({
      productId: P, founderId: OWNER, responsibilityId,
      recipient: 'ines@example.com', subject: 'Saturday 10am needs cover',
      body: 'Marta is off this Saturday — can you take the 10am beginners class?',
    });
    expect('notice' in written).toBe(true);
    const noticeId = (written as { notice: { id: string } }).notice.id;

    const planned = await planResponsibilityNotice({ productId: P, founderId: OWNER, noticeId });
    expect('actionId' in planned).toBe(true);
    const actionId = (planned as { actionId: string }).actionId;

    await executeAssistedSupportEmail(actionId);

    // It crossed the ordinary governed email boundary and was recorded there,
    // whether or not a provider is configured in this environment.
    expect((await query(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [P],
    )).rows[0] as Record<string, unknown>).toMatchObject({ n: 1 });

    // And the outcome is unresolved. A provider accepting an email is not Ines
    // turning up on Saturday, and nothing in this chain is allowed to pretend
    // otherwise.
    expect((await query(
      'SELECT outcome_status FROM outbound_actions WHERE id=?', [actionId])).rows[0])
      .toMatchObject({ outcome_status: 'unresolved' });
  });

  it('stops the moment the owner withdraws permission, mid-flight', async () => {
    const written = await proposeResponsibilityNotice({
      productId: P, founderId: OWNER, responsibilityId,
      recipient: 'ines@example.com', subject: 'Next Saturday too',
      body: 'And could you take the 10am the week after as well?',
    });
    const planned = await planResponsibilityNotice({
      productId: P, founderId: OWNER, noticeId: (written as { notice: { id: string } }).notice.id,
    });
    const actionId = (planned as { actionId: string }).actionId;

    const before = (await query(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [P],
    )).rows[0];

    // Revoked after the execution claim and before dispatch — the hardest
    // window the architecture supports, on a company that is not doing support.
    const result = await executeAssistedSupportEmail(actionId, {
      afterClaim: async () => {
        await revokeAssistingAuthority({ productId: P, responsibilityId, founderId: OWNER });
      },
    });
    expect(result).toMatchObject({ dispatched: false, certainty: 'not_attempted' });
    expect((await query(
      `SELECT COUNT(*) n FROM audit_log WHERE product_id=? AND action_type='gateway:send_email'`, [P],
    )).rows[0]).toEqual(before);

    // Revocation is not demotion: the school is still Assisting, and Foundry
    // has not forgotten how to help. It simply may not.
    expect((await query(
      'SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting' });
  });

  it('never reached Operating, and never will by this route', async () => {
    // Carrying real work well is not an argument for more authority. Migration
    // 115's freeze applies to a dance school exactly as it does to everyone.
    expect((await query(
      "SELECT COUNT(*) n FROM institutional_responsibilities WHERE product_id=? AND state='operating'", [P],
    )).rows[0]).toMatchObject({ n: 0 });
  });
});
