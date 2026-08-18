process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  ASSISTED_EMAIL_SCOPE, RESPONSIBILITY_NOTICE_SCOPE, planAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { moveResponsibilityTo } from '../fixtures/responsibility-state.js';

// =============================================================================
// The governed effect boundary stops being support-only.
//
// Migration 114's guard was the boundary that makes irreversible things
// irreversible, and it named one capability: customer_support. Everything else
// in it was general. So four unfamiliar companies could climb to Shadowing and
// then stop — a dance school telling a teacher their class needs cover could
// not use a mechanism that was, in every respect that matters, the same one.
//
// What must NOT change: a company may declare what it counts, because reading a
// number is harmless. A company may never declare a new irreversible way to
// reach the outside world.
// =============================================================================

const P = 'gek_co';
const OWNER = 'gek_owner';

/** An Assisting responsibility of any capability, with a live grant. */
async function assisting(
  id: string, capability: string, scopes: string[], boundary = 'low',
): Promise<string> {
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'repository','development_need_observed','low','{}','seed')`, [`${id}_sig`, P]);
  // Created at `shadowing`, granted, then admitted — the real order. Granting
  // to a responsibility that is ALREADY assisting requires shadow comparison
  // evidence (migration 133), and short-cutting that guard to build a fixture
  // would be testing a system this repository does not have.
  await query(
    `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
     VALUES (?,?,?,?,'shadowing',?)`, [id, P, `Responsibility ${id}`, capability, `signal_event:${id}_sig`]);
  const consentId = `${id}_consent`;
  await query(
    `INSERT INTO autonomy_consents
       (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
        responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
     VALUES (?,?,?,?,'suggest','act','v1',?,?,?,datetime('now','+1 day'))`,
    [consentId, OWNER, P, capability, id, JSON.stringify(scopes), boundary]);
  await moveResponsibilityTo(id, 'assisting',
    { productId: P, authorityRef: `autonomy_consent:${consentId}` });
  return consentId;
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','gek_c','o@example.com')`, []);
  await query(`INSERT INTO products (id,name,owner_id) VALUES ('${P}','Fold Street Dance','${OWNER}')`, []);
});

describe('governed effect kinds', () => {
  it('lets a capability that is not customer support carry a governed effect', async () => {
    // The whole point. This responsibility is `operations` — a dance school
    // making sure every timetabled class has a teacher — and it reaches the
    // same boundary on the same terms.
    const consentId = await assisting('gek_ops', 'operations', [RESPONSIBILITY_NOTICE_SCOPE]);
    const actionId = await planAssistedSupportEmail({
      productId: P, responsibilityId: 'gek_ops', authorityConsentId: consentId,
      effectId: 'gek_effect_1', to: 'teacher@example.com', subject: 'Saturday 10am needs cover',
      html: '<p>Written by the studio manager.</p>', rationale: 'The founder wrote this notice',
      scope: RESPONSIBILITY_NOTICE_SCOPE,
    });
    expect(actionId).toBeTruthy();

    const row = (await query(
      'SELECT authority_scope,action_type,integration_name,status,outcome_status FROM outbound_actions WHERE id=?',
      [actionId])).rows[0];
    expect(row).toMatchObject({
      authority_scope: RESPONSIBILITY_NOTICE_SCOPE, action_type: 'send_email',
      integration_name: 'resend', status: 'approved', outcome_status: 'unresolved',
    });
  });

  it('still refuses everything migration 114 refused', async () => {
    const consentId = await assisting('gek_sup', 'customer_support', [ASSISTED_EMAIL_SCOPE]);

    // A scope that was never granted.
    await expect(planAssistedSupportEmail({
      productId: P, responsibilityId: 'gek_sup', authorityConsentId: consentId,
      effectId: 'gek_e2', to: 'a@b.com', subject: 's', html: 'h', rationale: 'r',
      scope: RESPONSIBILITY_NOTICE_SCOPE,
    })).rejects.toThrow(/binding_invalid/);

    // A consent belonging to a different responsibility.
    const otherConsent = await assisting('gek_other', 'operations', [RESPONSIBILITY_NOTICE_SCOPE]);
    await expect(planAssistedSupportEmail({
      productId: P, responsibilityId: 'gek_sup', authorityConsentId: otherConsent,
      effectId: 'gek_e3', to: 'a@b.com', subject: 's', html: 'h', rationale: 'r',
      scope: ASSISTED_EMAIL_SCOPE,
    })).rejects.toThrow(/binding_invalid/);

    // A revoked grant.
    await query("UPDATE autonomy_consents SET revoked_at=datetime('now') WHERE id=?", [consentId]);
    await expect(planAssistedSupportEmail({
      productId: P, responsibilityId: 'gek_sup', authorityConsentId: consentId,
      effectId: 'gek_e4', to: 'a@b.com', subject: 's', html: 'h', rationale: 'r',
    })).rejects.toThrow(/binding_invalid/);
  });

  it('closes a NULL hole migration 114 left open', async () => {
    // `NEW.authority_scope!='send_email:support_reply'` is NULL — not true —
    // when the column is absent, and a RAISE guarded by NULL never fires. So a
    // plan with no scope, no effect id and no consent walked past the boundary
    // and was caught further down by a different guard, or not at all.
    //
    // What actually closes it is the declared-kind lookup: `k.scope_key = NULL`
    // matches nothing, so NOT EXISTS is TRUE and the guard fires. Mutation
    // testing showed the explicit `IS NULL` clauses are belt-and-braces rather
    // than load-bearing — removing them still refuses this row. They are kept
    // because they say the intent out loud, but the lookup is the mechanism.
    await assisting('gek_null', 'operations', [RESPONSIBILITY_NOTICE_SCOPE]);
    await expect(query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,responsibility_id)
       VALUES ('gek_bare',?,'x','resend','send_email','approved','{}','r','gek_null')`, [P],
    )).rejects.toThrow(/assisted_action:binding_invalid/);
  });

  it('cannot even construct a consent whose capability disagrees with the responsibility', async () => {
    // Capability is no longer NAMED by the boundary, which is the point of
    // migration 136. What still must hold is that a responsibility and its
    // consent AGREE about it — otherwise a grant for answering customers could
    // be spent on operations work, and the founder's "yes" would have covered
    // something they never saw.
    //
    // A mutation removing `a.capability=r.capability` from the effect guard
    // passed every test, which looked like missing coverage. It is not: the
    // mismatched consent cannot be created in the first place, so the effect
    // guard's copy of the rule is defence in depth against a state the schema
    // does not permit. That is worth knowing and worth asserting at the place
    // it is actually enforced.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('gek_mm_sig',?,'repository','development_need_observed','low','{}','seed')`, [P]);
    await query(
      `INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,discovery_evidence_ref)
       VALUES ('gek_mm',?,'Mismatched','operations','shadowing','signal_event:gek_mm_sig')`, [P]);

    await expect(query(
      `INSERT INTO autonomy_consents
         (id,founder_id,product_id,capability,from_mode,to_mode,disclosure_version,
          responsibility_id,allowed_scope_json,consequence_boundary,expires_at)
       VALUES ('gek_mm_consent',?,?,'customer_support','suggest','act','v1','gek_mm',?,'low',datetime('now','+1 day'))`,
      [OWNER, P, JSON.stringify([RESPONSIBILITY_NOTICE_SCOPE])],
    )).rejects.toThrow(/invalid_binding/);
  });

  it('refuses an action and a scope taken from different effect kinds', async () => {
    // A caller must not be able to combine the action of one declared kind with
    // the scope of another and land somewhere nobody authorised.
    const consentId = await assisting('gek_mix', 'operations', [RESPONSIBILITY_NOTICE_SCOPE]);
    await expect(query(
      `INSERT INTO outbound_actions
         (id,product_id,agent_name,integration_name,action_type,status,parameters_json,rationale,
          responsibility_id,authority_consent_id,authority_scope,effect_id)
       VALUES ('gek_mixrow',?,'x','resend','delete_records','approved','{}','r','gek_mix',?,?,'gek_e5')`,
      [P, consentId, RESPONSIBILITY_NOTICE_SCOPE],
    )).rejects.toThrow(/assisted_action:binding_invalid/);
  });

  it('refuses a consequence class the grant was not given at', async () => {
    // Adding an effect kind must never be a way to widen consequence. The
    // consent's boundary must equal the kind's exactly.
    const consentId = await assisting('gek_high', 'operations', [RESPONSIBILITY_NOTICE_SCOPE], 'high');
    await expect(planAssistedSupportEmail({
      productId: P, responsibilityId: 'gek_high', authorityConsentId: consentId,
      effectId: 'gek_e6', to: 'a@b.com', subject: 's', html: 'h', rationale: 'r',
      scope: RESPONSIBILITY_NOTICE_SCOPE,
    })).rejects.toThrow(/binding_invalid/);
  });

  it('has no code path anywhere that could create an effect kind', async () => {
    // The owner settled this: a company may declare what it COUNTS, because
    // reading a number is harmless, and may NEVER declare a new irreversible
    // way to reach the outside world. The database refuses it (below), but a
    // future session could add a service that writes the table through some
    // other route, or a migration that re-opens it.
    //
    // This makes the decision structural rather than a note in a document.
    const { readFileSync, readdirSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });

    const writers = walk(resolve(process.cwd(), 'src'))
      .filter((f) => /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+governed_effect_kinds/i
        .test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(process.cwd() + '/', ''));
    expect(writers,
      'Effect kinds are constitutional: they widen only by editing a migration, '
      + 'which is inside the ring. Nothing in src/ may write this table:\n' + writers.join('\n'),
    ).toEqual([]);

    // And the guards that enforce it must still exist, so a later migration
    // cannot quietly drop them while leaving the table in place.
    const triggers = (await query(
      `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'governed_effect_kinds%'
        ORDER BY name`)).rows.map((r) => String((r as Record<string, unknown>).name));
    expect(triggers).toEqual([
      'governed_effect_kinds_immutable_delete',
      'governed_effect_kinds_immutable_insert',
      'governed_effect_kinds_immutable_update',
    ]);
  });

  it('keeps the effect vocabulary constitutional — nothing can widen it at runtime', async () => {
    // A company may declare what it COUNTS, because reading a number is
    // harmless. It may never declare a new irreversible way to reach the
    // outside world. That distinction is the whole difference between
    // migration 135 and this one.
    await expect(query(
      `INSERT INTO governed_effect_kinds (scope_key,action_type,integration_name,consequence_boundary,description)
       VALUES ('send_email:anything_i_like','send_email','resend','low','mine')`,
    )).rejects.toThrow(/constitutional/);

    await expect(query(
      "UPDATE governed_effect_kinds SET consequence_boundary='high' WHERE scope_key=?",
      [ASSISTED_EMAIL_SCOPE])).rejects.toThrow(/constitutional/);

    await expect(query(
      'DELETE FROM governed_effect_kinds WHERE scope_key=?', [ASSISTED_EMAIL_SCOPE],
    )).rejects.toThrow(/constitutional/);

    // And the vocabulary is exactly what the migration seeded.
    const kinds = (await query('SELECT scope_key FROM governed_effect_kinds ORDER BY scope_key')).rows
      .map((r) => String((r as Record<string, unknown>).scope_key));
    expect(kinds).toEqual([ASSISTED_EMAIL_SCOPE, RESPONSIBILITY_NOTICE_SCOPE].sort());
  });
});
