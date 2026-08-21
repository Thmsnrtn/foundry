process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { beginResponsibilityShadowing,compareShadowObservation } from '../../src/services/institution/responsibility-shadowing.js';
import { evaluateE3ResponsibilityShadowingGate,scoreResponsibilityShadowing,
  type ShadowActual,type ShadowClassification,type ShadowTruth } from '../../src/services/institution/responsibility-shadowing-benchmark.js';

const fixtures=[
  {id:'shadow_support',capability:'customer_support',expected:'support_restored',actual:'support_restored',classification:'matched' as const,expired:false},
  {id:'shadow_development',capability:'development',expected:'deploy_succeeded',actual:'deploy_failed',classification:'deviated' as const,expired:false},
  {id:'shadow_billing',capability:'billing_recovery',expected:'payment_recovered',actual:'provider_acknowledged',classification:'deviated' as const,expired:false},
  {id:'shadow_operations',capability:'operations',expected:'shift_covered',actual:'shift_status_unknown',classification:'unresolved' as const,expired:true},
];
const expectationIds=new Map<string,string>();

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('shadow_bench_owner','shadow_bench_clerk','shadow@example.com'),('shadow_bench_foreign','shadow_bench_foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('shadow_bench_product','Shadow Bench','shadow_bench_owner'),('shadow_bench_foreign_product','Foreign','shadow_bench_foreign')",[]);
  for (const fixture of fixtures) {
    await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
      VALUES (?,'shadow_bench_product',?,?,'understood')`,[fixture.id,`Responsibility ${fixture.id}`,fixture.capability]);
    await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
      (?, 'shadow_bench_product','observer','channel_ready','low','{}','Independent channel ready'),
      (?, 'shadow_bench_product','external_actor',?,'medium','{}','Independent actual event')`,
    [`${fixture.id}_channel`,`${fixture.id}_actual`,fixture.actual]);
    const claim=await recordReconstructionClaim({productId:'shadow_bench_product',subject:`responsibility:${fixture.id}`,
      predicate:'expected_observed_event',value:fixture.expected,epistemicStatus:'known',
      evidenceRefs:[{kind:'signal_event',id:`${fixture.id}_channel`}],derivationMethod:'held-out bounded expectation',observedAt:new Date()});
    await beginResponsibilityShadowing({productId:'shadow_bench_product',responsibilityId:fixture.id,expectedEventType:fixture.expected,
      expectationClaimId:claim,observationSourceSignalId:`${fixture.id}_channel`,
      // The channel that may resolve this expectation, named rather than inferred:
      // here the channel signal is an 'observer' event and the actual is an
      // 'external_actor' one, so no rule derived from the channel signal's own
      // source could have worked. Migration 191 has the account.
      observationSourceKind:'external_actor',
      validUntil:fixture.expired?new Date('2020-01-01'):new Date('2099-01-01')});
    const expectation=await query('SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=?',[fixture.id]);
    const expectationId=String((expectation.rows[0] as Record<string,unknown>).id); expectationIds.set(fixture.id,expectationId);
    await Promise.all([1,2,3].map(()=>compareShadowObservation({productId:'shadow_bench_product',expectationId,
      observationSignalId:`${fixture.id}_actual`})));
  }
  await query("INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES ('shadow_bench_foreign_event','shadow_bench_foreign_product','foreign','support_restored','high','{}','Foreign event')",[]);
});

async function actualFor(id:string):Promise<ShadowActual> {
  const expectationId=expectationIds.get(id)!;
  const comparisons=await query(`SELECT c.observation_ref,c.classification,e.id AS evidence_id
    FROM responsibility_shadow_comparisons c JOIN signal_events e ON c.observation_ref='signal_event:' || e.id
    WHERE c.expectation_id=?`,[expectationId]);
  const responsibility=await query('SELECT state,authority_ref FROM institutional_responsibilities WHERE id=?',[id]);
  return {productId:'shadow_bench_product',observations:comparisons.rows.map((row)=>({ref:String(row.observation_ref),
    classification:String(row.classification) as ShadowClassification,provenanceComplete:row.evidence_id!=null})),
    duplicateObservations:0,responsibilityState:String(responsibility.rows[0].state),
    authorityRef:responsibility.rows[0].authority_ref==null?null:String(responsibility.rows[0].authority_ref),
    createdActions:0,createdExecutions:0};
}

describe('responsibility shadowing prospective benchmark',()=>{
  it('runs four capability shapes through independent canonical observations and the unchanged gate',async()=>{
    const results=[];
    for (const fixture of fixtures) {
      const ref=`signal_event:${fixture.id}_actual`;
      const truth:ShadowTruth={productId:'shadow_bench_product',expected:{[ref]:fixture.classification}};
      results.push(scoreResponsibilityShadowing(await actualFor(fixture.id),truth));
    }
    expect(evaluateE3ResponsibilityShadowingGate(results)).toEqual({passed:true,reasons:[]});
  });

  it('refuses foreign observations and fails hard if Shadowing creates execution or authority',async()=>{
    await expect(compareShadowObservation({productId:'shadow_bench_product',expectationId:expectationIds.get('shadow_support')!,
      observationSignalId:'shadow_bench_foreign_event'})).rejects.toThrow(/refused/);
    const actual=await actualFor('shadow_support'); actual.createdExecutions=1; actual.authorityRef='forged';
    const result=scoreResponsibilityShadowing(actual,{productId:'shadow_bench_product',
      expected:{'signal_event:shadow_support_actual':'matched'}});
    expect(result.hardFailures).toContain('shadowing_created_authority_or_execution');
    expect(evaluateE3ResponsibilityShadowingGate([result,result,result,result]).passed).toBe(false);
  });
});
