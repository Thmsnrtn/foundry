process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getEffectOutcomeReports, getUnresolvedEffects, reportEffectOutcome,
} from '../../src/services/institution/effect-outcome.js';
import { reconcileAssistedSupportEmail } from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// The last link of the loop finally has a supply.
//
//   … → Execution → Receipt → Outcome → Learning
//
// Nothing in production had ever produced outcome evidence, so `outcome_status`
// was permanently `unresolved` — correct as a default and a poor destination.
// Preserving `unresolved` was always right; being UNABLE to leave it means the
// institution can act and can never learn.
//
// What must stay true: Foundry may not report on itself, disagreement is
// preserved rather than resolved toward the convenient answer, and learning
// that something worked grants nothing.
// =============================================================================

const P = 'eo_co';
const OWNER = 'eo_owner';
const RESP = 'eo_resp';

/** An executed effect, built through the real bindings. The plan guard refuses
 * an action bound to a responsibility with no live authority — as it should —
 * so the fixture carries a genuine grant rather than side-stepping it. */
async function executedEffect(effectId: string, actionId: string): Promise<void> {
  await query(
    `INSERT INTO outbound_actions
       (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
        preview_text,responsibility_id,authority_consent_id,authority_scope,effect_id,executed_at,outcome_status)
     VALUES (?,?,'institution:assisting','resend','send_email','executed','{}','r',
             'Send bounded responsibility notice to ines@example.com',?,'eo_consent',
             'send_email:responsibility_notice',?,datetime('now'),'unresolved')`,
    [actionId, P, RESP, effectId]);
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','eo_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Fold Street Dance','${OWNER}')`, []);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES ('eo_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,'Every timetabled class has a teacher','operations','shadowing','signal_event:eo_sig')`, [RESP, P]);
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES ('eo_consent',?,?,'operations','suggest','act','v1',?,?, 'low',datetime('now','+1 day'))`,
    [OWNER, P, RESP, JSON.stringify(['send_email:responsibility_notice'])]);
  await moveResponsibilityTo(RESP, 'assisting',
    { productId: P, authorityRef: 'autonomy_consent:eo_consent' });
  await executedEffect('eo_effect_1', 'eo_action_1');
});

describe('effect outcome reports', () => {
  it('asks about effects that dispatched and that nobody has answered', async () => {
    const open = await getUnresolvedEffects(P);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ effectId: 'eo_effect_1', responsibilityId: RESP });
    expect(open[0].title).toContain('teacher');
  });

  it('records what someone outside says, with their name on it', async () => {
    const reported = await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'achieved',
      reporter: `founder:${OWNER}`, detail: 'Ines took the class',
    });
    expect(reported).toMatchObject({ verdict: 'achieved', reporter: `founder:${OWNER}` });

    const reports = await getEffectOutcomeReports(P, 'eo_effect_1');
    expect(reports).toHaveLength(1);
    expect(reports[0].detail).toBe('Ines took the class');

    // The same reporter saying the same thing twice is one witness, not two.
    await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'achieved', reporter: `founder:${OWNER}`,
    });
    expect(await getEffectOutcomeReports(P, 'eo_effect_1')).toHaveLength(1);
  });

  it('lets reconciliation finally leave unresolved', async () => {
    // Before migration 137 this could only ever return `unresolved`, because
    // nothing in production produced either shape of evidence.
    expect(await reconcileAssistedSupportEmail(P, 'eo_action_1')).toBe('verified_success');
    expect((await query(
      'SELECT outcome_status FROM outbound_actions WHERE id=?', ['eo_action_1'])).rows[0])
      .toMatchObject({ outcome_status: 'verified_success' });

    // Answered effects stop being asked about.
    expect(await getUnresolvedEffects(P)).toHaveLength(0);

    // Learning grants nothing. The grant that authorised the send is still the
    // only one, unchanged and unwidened by the news that it worked.
    const consents = (await query(
      'SELECT id,allowed_scope_json,consequence_boundary,expires_at FROM autonomy_consents WHERE product_id=?', [P],
    )).rows;
    expect(consents).toHaveLength(1);
    expect(consents[0]).toMatchObject({ id: 'eo_consent', consequence_boundary: 'low' });
    // And nothing was promoted by succeeding.
    expect((await query(
      'SELECT state FROM institutional_responsibilities WHERE id=?', [RESP])).rows[0])
      .toMatchObject({ state: 'assisting' });
  });

  it('preserves disagreement instead of resolving it toward the convenient answer', async () => {
    await executedEffect('eo_effect_2', 'eo_action_2');
    await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_2', verdict: 'achieved', reporter: `founder:${OWNER}` });
    await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_2', verdict: 'failed', reporter: 'external:rota_system' });

    expect(await reconcileAssistedSupportEmail(P, 'eo_action_2')).toBe('conflicting');
    // Both witnesses survive. Neither is deleted to make the record tidy.
    expect(await getEffectOutcomeReports(P, 'eo_effect_2')).toHaveLength(2);
  });

  it('refuses to let Foundry report on itself', async () => {
    // A system that can declare its own success has no outcome layer, only a
    // louder execution layer. Refused in the service AND in the database.
    await executedEffect('eo_effect_3', 'eo_action_3');
    expect(await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_3', verdict: 'achieved', reporter: 'institution:assisting',
    })).toEqual({ refused: 'reporter_invalid' });

    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('eo_self',?,'effect_outcome_report','effect_outcome:eo_effect_3:achieved','low',
               json_object('effect_id','eo_effect_3','verdict','achieved','reporter','institution:assisting'),'x')`,
      [P])).rejects.toThrow(/self_reported/);
  });

  it('refuses an outcome for something that never happened', async () => {
    // An effect that was refused, revoked, or never dispatched has no result to
    // report, and inventing one would be manufacturing the thing the whole loop
    // exists to establish honestly.
    expect(await reportEffectOutcome({
      productId: P, effectId: 'never_dispatched', verdict: 'achieved', reporter: `founder:${OWNER}`,
    })).toEqual({ refused: 'not_executed' });

    await query(
      `INSERT INTO outbound_actions (id,product_id,agent_name,integration_name,action_type,status,
        parameters_json,rationale,responsibility_id,authority_consent_id,authority_scope,effect_id)
       VALUES ('eo_planned',?,'x','resend','send_email','approved','{}','r',?,'eo_consent',
               'send_email:responsibility_notice','eo_effect_planned')`, [P, RESP]);
    expect(await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_planned', verdict: 'achieved', reporter: `founder:${OWNER}`,
    })).toEqual({ refused: 'not_executed' });
  });

  it('refuses a malformed verdict, a missing reporter, and a mislabelled event', async () => {
    expect(await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'probably', reporter: `founder:${OWNER}`,
    })).toEqual({ refused: 'verdict_invalid' });
    expect(await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'achieved', reporter: '  ',
    })).toEqual({ refused: 'reporter_invalid' });

    // The event type is derived from the report, so a comparison matches on
    // what was reported rather than on a label the caller chose.
    await expect(query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('eo_mislabel',?,'effect_outcome_report','effect_outcome:eo_effect_1:failed','low',
               json_object('effect_id','eo_effect_1','verdict','achieved','reporter','external:x'),'x')`,
      [P])).rejects.toThrow(/event_type_mismatch/);
  });

  it('keeps one company\'s outcome reports out of another\'s', async () => {
    await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('eo_o2','eo_c2','x@example.com')`, []);
    await query(`INSERT INTO products (id,name,owner_id) VALUES ('eo_other','Other Co','eo_o2')`, []);
    // The effect belongs to another company; this one cannot report on it.
    expect(await reportEffectOutcome({
      productId: 'eo_other', effectId: 'eo_effect_1', verdict: 'failed', reporter: 'founder:eo_o2',
    })).toEqual({ refused: 'not_executed' });
  });
});

// =============================================================================
// Disagreement, shown.
//
// `conflicting` is preserved deliberately — two witnesses who disagree are
// never resolved toward the convenient answer. But the founder-facing surface
// said only "business evidence conflicts; owner judgment may be needed", which
// asks a person to exercise judgment while withholding the thing they would
// exercise it on. `getEffectOutcomeReports` had no route caller at all.
// =============================================================================

describe('what the owner is shown when reporters disagree', () => {
  it('names who said what, on the effect they disagreed about', async () => {
    const { getDisputedEffects } = await import('../../src/services/institution/effect-outcome.js');
    const disputed = await getDisputedEffects(P);

    // eo_effect_2 is the one two reporters split on, earlier in this file.
    expect(disputed.map((d) => d.effectId)).toEqual(['eo_effect_2']);
    const reports = disputed[0].reports;
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => `${r.reporter}:${r.verdict}`).sort())
      .toEqual([`external:rota_system:failed`, `founder:${OWNER}:achieved`]);
  });

  it('shows only genuine disagreement, not every effect', async () => {
    const { getDisputedEffects } = await import('../../src/services/institution/effect-outcome.js');
    const disputed = await getDisputedEffects(P);
    // eo_effect_1 was agreed (verified_success) and must not appear as disputed.
    expect(disputed.map((d) => d.effectId)).not.toContain('eo_effect_1');
  });

  it('keeps one company\'s dispute out of another\'s', async () => {
    const { getDisputedEffects } = await import('../../src/services/institution/effect-outcome.js');
    expect(await getDisputedEffects('eo_other')).toEqual([]);
  });

  it('is read by production, not only by this test', () => {
    const letter = readFileSync(
      resolve(__dirname, '../../src/routes/dashboard/letter.ts'), 'utf8');
    expect(letter).toContain('getDisputedEffects');
    expect(letter).toContain('disputedSection(disputedEffects)');
    // And it must not offer to settle what it cannot settle.
    expect(letter).toContain('I am not going to pick one');
  });
});

// =============================================================================
// Provenance survives into what the founder actually reads.
//
// `outcome_status` spells its success value `verified_success`, and the
// founder-facing sentence rendered that as "business outcome verified". It is
// not. One person or one system saying "that worked" is a REPORT about an
// outcome; it does not become an independent verification by having arrived
// through an authenticated endpoint — which is exactly the claim the outcome
// layer exists to refuse.
//
// The stored vocabulary is deliberately unchanged. Renaming it would touch
// migrations, guards and readers for a vocabulary change; the honest fix is
// smaller and closer to the person being told.
// =============================================================================

describe('what the founder is told about an outcome', () => {
  it('says who reported it, so a self-report does not read as a verification', async () => {
    const { getFounderAssistingActivity } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    const activity = await getFounderAssistingActivity(P);

    const owned = activity.find((a) => a.detail.includes('you told me'));
    expect(owned, 'an owner self-report must say so').toBeTruthy();
    expect(owned!.detail).toContain('reported, not independently confirmed');
    // The old sentence claimed more than the evidence does.
    expect(JSON.stringify(activity)).not.toContain('business outcome verified');
  });

  it('distinguishes a connected system from the owner', async () => {
    await executedEffect('eo_effect_ext', 'eo_action_ext');
    await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_ext', verdict: 'achieved',
      reporter: 'external:rota_system' });
    await reconcileAssistedSupportEmail(P, 'eo_action_ext');

    const { getFounderAssistingActivity } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    const activity = await getFounderAssistingActivity(P);
    // THE SUBJECT IS THAT A CONNECTED SYSTEM IS TOLD APART FROM THE OWNER, and
    // it survives: the phrasing gained the name the system gave itself, which
    // says MORE than the category did. The assertion follows the subject rather
    // than the sentence it was written against.
    // THE LINE, NOT THE PAGE. My first version of this joined every activity
    // line and asserted "you told me" was absent — but other lines on the same
    // page legitimately say it, because the founder really did report those.
    // The subject is that THIS witness is told apart from the owner, so the
    // assertion looks at the line the external report produced.
    const line = activity.map((a) => a.detail).find((d) => d.includes('rota_system'));
    expect(line, 'the external report should produce a line of its own').toBeTruthy();
    expect(line!).toMatch(/a system you connected/);
    expect(line!).not.toMatch(/you told me/);
  });

  it('refuses an unbounded detail rather than storing or truncating it', async () => {
    // THE ONE UNBOUNDED EXTERNAL STRING ON A PUBLIC DOOR.
    // `POST /ingest/effect-outcome/:token` is token-authed and open, and every
    // other external string on it and its neighbours is bounded — `reported_by`
    // sliced to 120, `what` refused past 200, a customer's message body refused
    // past 8192, the custom-metrics drawer capped at 8KB since the 2026-07-13
    // close-out. `detail` was trimmed and stored, with no length anywhere,
    // straight into `signal_events.payload_json`.
    //
    // Refused, not truncated: a truncated explanation is a different
    // explanation, and this record is evidence a person reads to decide whether
    // something worked.
    const { MAX_OUTCOME_DETAIL_CHARS } = await import(
      '../../src/services/institution/effect-outcome.js');
    const refused = await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'achieved',
      reporter: 'external:some_tool', detail: 'x'.repeat(MAX_OUTCOME_DETAIL_CHARS + 1),
    });
    expect(refused).toEqual({ refused: 'detail_too_long' });

    const stored = await query(
      "SELECT COUNT(*) AS n FROM signal_events WHERE product_id=? AND source='effect_outcome_report'"
      + " AND payload_json LIKE '%xxxxxxxxxx%'", [P]);
    expect(Number((stored.rows[0] as unknown as { n: number }).n)).toBe(0);
  });

  it('accepts a detail right at the bound, so the limit is the limit', async () => {
    const { MAX_OUTCOME_DETAIL_CHARS } = await import(
      '../../src/services/institution/effect-outcome.js');
    const accepted = await reportEffectOutcome({
      productId: P, effectId: 'eo_effect_1', verdict: 'failed',
      reporter: 'external:another_tool', detail: 'y'.repeat(MAX_OUTCOME_DETAIL_CHARS),
    });
    expect('refused' in accepted).toBe(false);
  });

  it('says plainly that it will not settle a disagreement', async () => {
    const { getFounderAssistingActivity } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    const activity = await getFounderAssistingActivity(P);
    const disputed = activity.find((a) => a.detail.includes('disagree'));
    expect(disputed?.detail).toContain('will not pick one');
  });

  it('never calls a provider receipt an outcome', async () => {
    const { getFounderAssistingActivity } = await import(
      '../../src/services/institution/responsibility-assisted-email.js');
    for (const item of await getFounderAssistingActivity(P)) {
      if (!item.detail.includes('provider accepted')) continue;
      expect(item.detail).toContain('whether it worked is still unknown');
    }
  });
});
