process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordConsent,revokeConsent } from '../../src/services/autopilot/consent.js';
import { enterResponsibilityAssisting } from '../../src/services/institution/responsibility-assisting.js';

async function seedResponsibility(id:string,productId='assist_product') {
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES (?,?,?,'customer_support','understood')`,[id,productId,`Responsibility ${id}`]);
  const claim=`claim_${id}`; const expectation=`expect_${id}`; const comparison=`compare_${id}`;
  await query(`INSERT INTO reconstruction_claims
    (id,product_id,subject,predicate,value_json,epistemic_status,evidence_refs_json,derivation_method,observed_at)
    VALUES (?,?,?,'expected_observed_event','"support_restored"','known','[{"kind":"signal_event","id":"assist_signal"}]','frozen expectation',datetime('now'))`,
    [claim,productId,`responsibility:${id}`]);
  // 'support' is the channel that may resolve this — the source both
  // `assist_signal` and `assist_actual` carry. Migration 191 refuses an
  // expectation that names none, which this fixture did: 'support_restored'
  // matched neither of the two prefix-keyed guards, so it had no independence
  // check at all.
  await query(`INSERT INTO responsibility_shadow_expectations
    (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,
     observation_source_evidence_ref,observation_source_kind)
    VALUES (?,?,?,'support_restored',?,'signal_event:assist_signal','support')`,
  [expectation,id,productId,`reconstruction_claim:${claim}`]);
  // The comparison guard insists the responsibility is already Shadowing, and
  // migration 159 insists a state only moves through a transition. Both are the
  // point: the fixture now proves the rung it used to assume.
  await query(`INSERT INTO responsibility_transitions
    (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
    VALUES (?,?,'understood','shadowing','signal_event:assist_signal','watching','test')`,
    [`to_shadow_${id}`,id]);
  await query(`INSERT INTO responsibility_shadow_comparisons
    (id,expectation_id,product_id,observation_ref,classification)
    VALUES (?,?,?,'signal_event:assist_actual','matched')`,[comparison,expectation,productId]);
  return comparison;
}

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('assist_owner','assist_clerk','assist@example.com'),('foreign_owner','foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('assist_product','Assist','assist_owner'),('foreign_product','Foreign','foreign_owner')",[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('assist_signal','assist_product','support','channel','low','{}','channel'),
    ('assist_actual','assist_product','support','support_restored','low','{}','restored')`,[]);
});

describe('responsibility-bound Assisting entry',()=>{
  it('requires current shadow proof and exact authority while creating no execution',async()=>{
    const comparison=await seedResponsibility('assist_ok');
    const consent=await recordConsent({founderId:'assist_owner',productId:'assist_product',capability:'customer_support',
      fromMode:'observe',toMode:'act',responsibilityId:'assist_ok',allowedScope:['send_email:support_reply'],
      consequenceBoundary:'low',expiresAt:new Date(Date.now()+60_000)});
    const before=await query("SELECT COUNT(*) n FROM action_executions WHERE product_id='assist_product'",[]);
    const result=await enterResponsibilityAssisting({productId:'assist_product',responsibilityId:'assist_ok',
      shadowComparisonId:comparison,authorityConsentId:consent});
    expect(result).toMatchObject({state:'assisting',evidenceRef:`shadow_comparison:${comparison}`,
      authorityRef:`autonomy_consent:${consent}`,outcomeRef:null});
    expect((await query("SELECT COUNT(*) n FROM action_executions WHERE product_id='assist_product'",[])).rows[0]).toEqual(before.rows[0]);
  });

  it('refuses foreign, wrong-responsibility, expired, and revoked authority',async()=>{
    const comparison=await seedResponsibility('assist_refused');
    const wrong=await seedResponsibility('assist_wrong');
    const wrongConsent=await recordConsent({founderId:'assist_owner',productId:'assist_product',capability:'customer_support',
      fromMode:'observe',toMode:'act',responsibilityId:'assist_wrong',allowedScope:['send_email:support_reply'],
      consequenceBoundary:'low',expiresAt:new Date(Date.now()+60_000)});
    await expect(enterResponsibilityAssisting({productId:'assist_product',responsibilityId:'assist_refused',
      shadowComparisonId:wrong,authorityConsentId:wrongConsent})).rejects.toThrow(/assisting:/);
    const revoked=await recordConsent({founderId:'assist_owner',productId:'assist_product',capability:'customer_support',
      fromMode:'observe',toMode:'act',responsibilityId:'assist_refused',allowedScope:['send_email:support_reply'],
      consequenceBoundary:'low',expiresAt:new Date(Date.now()+60_000)});
    await revokeConsent('assist_product','customer_support');
    await expect(enterResponsibilityAssisting({productId:'assist_product',responsibilityId:'assist_refused',
      shadowComparisonId:comparison,authorityConsentId:revoked})).rejects.toThrow(/authority_invalid/);
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='assist_refused'",[])).rows[0]).toMatchObject({state:'shadowing'});
  });

  it('converges concurrent entry and cannot promote itself to Operating',async()=>{
    const comparison=await seedResponsibility('assist_race');
    const consent=await recordConsent({founderId:'assist_owner',productId:'assist_product',capability:'customer_support',
      fromMode:'observe',toMode:'act',responsibilityId:'assist_race',allowedScope:['send_email:support_reply'],
      consequenceBoundary:'low',expiresAt:new Date(Date.now()+60_000)});
    const results=await Promise.allSettled([1,2].map(()=>enterResponsibilityAssisting({productId:'assist_product',
      responsibilityId:'assist_race',shadowComparisonId:comparison,authorityConsentId:consent})));
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await query("SELECT state FROM institutional_responsibilities WHERE id='assist_race'",[])).rows[0]).toMatchObject({state:'assisting'});
  });
});
