process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding,projectResponsibilityUnderstanding,requiredUnderstandingFacts,
  type UnderstandingFact } from '../../src/services/institution/responsibility-understanding.js';
import { evaluateE3ResponsibilityUnderstandingGate,scoreResponsibilityUnderstanding,
  type UnderstandingTruth } from '../../src/services/institution/responsibility-understanding-benchmark.js';

const fixtures=[
  {id:'under_bench_support',capability:'customer_support'},
  {id:'under_bench_development',capability:'development'},
  {id:'under_bench_billing',capability:'billing_recovery'},
  {id:'under_bench_operations',capability:'operations'},
];
const valueFor=(fact:UnderstandingFact,id:string)=>`${id}:${fact}:grounded`;

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('under_bench_owner','under_bench_clerk','bench@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('under_bench_product','Understanding Bench','under_bench_owner')",[]);
  await query("INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES ('under_bench_signal','under_bench_product','manual','operating_fact','medium','{}','Observed operating fact')",[]);
  for (const fixture of fixtures) {
    await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
      VALUES (?,'under_bench_product',?,?,'visible')`,[fixture.id,`Responsibility ${fixture.id}`,fixture.capability]);
    for (const fact of requiredUnderstandingFacts(fixture.capability)) await recordReconstructionClaim({
      productId:'under_bench_product',subject:`responsibility:${fixture.id}`,predicate:fact,value:valueFor(fact,fixture.id),
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'under_bench_signal'}],
      derivationMethod:'held-out typed operating fact',observedAt:new Date(),
    });
  }
});

describe('responsibility understanding prospective benchmark',()=>{
  it('runs diverse capability-specific requirements through the real transition path',async()=>{
    const results=[];
    for (const fixture of fixtures) {
      await earnResponsibilityUnderstanding('under_bench_product',fixture.id);
      const actual=await projectResponsibilityUnderstanding('under_bench_product',fixture.id);
      const requiredFacts=requiredUnderstandingFacts(fixture.capability);
      const truth:UnderstandingTruth={productId:'under_bench_product',responsibilityId:fixture.id,requiredFacts,
        expectedValues:Object.fromEntries(requiredFacts.map((fact)=>[fact,valueFor(fact,fixture.id)])),
        expectedUnresolved:[],shouldTransition:true};
      results.push(scoreResponsibilityUnderstanding(actual,truth));
    }
    expect(evaluateE3ResponsibilityUnderstandingGate(results)).toEqual({passed:true,reasons:[]});
    expect(requiredUnderstandingFacts('development')).toContain('systems');
    expect(requiredUnderstandingFacts('billing_recovery')).toContain('financial_consequence');
    expect(requiredUnderstandingFacts('customer_support')).not.toContain('financial_consequence');
  });

  it('treats a critical gap with an Understood state as catastrophic regardless of averages',async()=>{
    const actual=await projectResponsibilityUnderstanding('under_bench_product','under_bench_support');
    actual.missingCriticalFacts=['purpose'];
    const result=scoreResponsibilityUnderstanding(actual,{productId:'under_bench_product',responsibilityId:'under_bench_support',
      requiredFacts:requiredUnderstandingFacts('customer_support'),expectedValues:{},expectedUnresolved:[],shouldTransition:true});
    expect(result.hardFailures).toContain('understood_with_critical_gap');
    expect(evaluateE3ResponsibilityUnderstandingGate([result,result,result,result]).passed).toBe(false);
  });
});
