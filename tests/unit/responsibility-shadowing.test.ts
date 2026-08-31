process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { beginResponsibilityShadowing,compareShadowObservation,getMaterialShadowingExceptions } from '../../src/services/institution/responsibility-shadowing.js';

let expectationClaim:string;
beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('shadow_owner','shadow_clerk','shadow@example.com'),('shadow_foreign_owner','shadow_foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('shadow_product','Shadow Company','shadow_owner'),('shadow_foreign','Foreign','shadow_foreign_owner')",[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('shadow_channel','shadow_product','support','support_queue_observed','low','{}','Observation channel available'),
    ('shadow_actual','shadow_product','support','support_capacity_restored','medium','{}','Human restored capacity'),
    ('shadow_deviation','shadow_product','support','support_capacity_worsened','high','{}','Queue worsened'),
    ('shadow_foreign_actual','shadow_foreign','support','support_capacity_restored','medium','{}','Foreign')`,[]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES ('shadow_resp','shadow_product','Restore support capacity','customer_support','understood')`,[]);
  expectationClaim=await recordReconstructionClaim({productId:'shadow_product',subject:'responsibility:shadow_resp',
    predicate:'expected_observed_event',value:'support_capacity_restored',epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:'shadow_channel'}],derivationMethod:'bounded operating expectation',observedAt:new Date()});
});

describe('non-executing responsibility shadowing',()=>{
  it('requires an independent observation channel and advances with zero authority or execution',async()=>{
    const before=await query("SELECT COUNT(*) n FROM action_executions WHERE product_id='shadow_product'",[]);
    const responsibility=await beginResponsibilityShadowing({productId:'shadow_product',responsibilityId:'shadow_resp',
      expectedEventType:'support_capacity_restored',expectationClaimId:expectationClaim,observationSourceSignalId:'shadow_channel',
      observationSourceKind:'support'});
    expect(responsibility).toMatchObject({state:'shadowing',authorityRef:null});
    const after=await query("SELECT COUNT(*) n FROM action_executions WHERE product_id='shadow_product'",[]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('compares independent actual events, preserves deviations, and converges replay',async()=>{
    const expectation=await query("SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id='shadow_resp'",[]);
    const id=String((expectation.rows[0] as Record<string,unknown>).id);
    expect(await compareShadowObservation({productId:'shadow_product',expectationId:id,observationSignalId:'shadow_actual'})).toBe('matched');
    const deviations=await Promise.all([1,2,3].map(()=>compareShadowObservation({productId:'shadow_product',expectationId:id,
      observationSignalId:'shadow_deviation'})));
    expect(deviations).toEqual(['deviated','deviated','deviated']);
    expect((await query('SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE expectation_id=?',[id])).rows[0]).toMatchObject({n:2});
    const founderTruth=await getMaterialShadowingExceptions('shadow_product');
    expect(founderTruth).toEqual([expect.objectContaining({responsibilityId:'shadow_resp',classification:'deviated',
      observedSummary:'Queue worsened'})]);
  });

  it('refuses cross-tenant observations and fabricated expectations without partial learning',async()=>{
    const expectation=await query("SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id='shadow_resp'",[]);
    const id=String((expectation.rows[0] as Record<string,unknown>).id);
    await expect(compareShadowObservation({productId:'shadow_product',expectationId:id,
      observationSignalId:'shadow_foreign_actual'})).rejects.toThrow(/refused/);
    await expect(beginResponsibilityShadowing({productId:'shadow_product',responsibilityId:'missing',
      expectedEventType:'x',expectationClaimId:expectationClaim,observationSourceSignalId:'shadow_channel'})).rejects.toThrow();
    expect((await query('SELECT COUNT(*) n FROM responsibility_shadow_comparisons WHERE expectation_id=?',[id])).rows[0]).toMatchObject({n:2});
  });
});
