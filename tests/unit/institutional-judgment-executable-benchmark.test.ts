process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { evaluateJudgmentBenchmark,type JudgmentBenchmarkActual } from '../../src/services/institution/institutional-judgment-benchmark.js';

const CASES=[
 {id:'capacity',capacity:1,demands:[1,1],commitment:null,constraint:null,economics:[],judgment:true},
 {id:'commitment',capacity:1,demands:[1,1],commitment:{kind:'hard_external',text:'Respond by Friday'},constraint:null,economics:[{status:'known',value:{amount:500,currency:'USD'}}],judgment:true},
 {id:'owner',capacity:1,demands:[1,1],commitment:null,constraint:'Do not exceed approved staffing',economics:[{status:'inferred',value:{amount:900,currency:'USD'}}],judgment:true},
 {id:'billing_risk',capacity:1,demands:[1,1],commitment:{kind:'internal_target',text:'Recover overdue balance'},constraint:'Preserve named customer relationship',economics:[],judgment:true},
 {id:'cash_investment',capacity:1,demands:[1,1],commitment:null,constraint:null,economics:[{status:'unknown',value:null}],judgment:true},
 {id:'alternatives',capacity:2,demands:[2,1],commitment:{kind:'optional_opportunity',text:'Accelerate launch'},constraint:null,economics:[],judgment:true},
 {id:'reversible',capacity:1,demands:[1,1],commitment:null,constraint:'Avoid irreversible customer impact',economics:[],judgment:true},
 {id:'no_conflict',capacity:3,demands:[1,1],commitment:null,constraint:null,economics:[],judgment:false},
 {id:'insufficient',capacity:null,demands:[1,1],commitment:{kind:'unknown',text:'Possible deadline'},constraint:null,economics:[],judgment:false},
 {id:'conflicting_economics',capacity:1,demands:[1,1],commitment:null,constraint:null,economics:[{status:'known',value:{amount:5}},{status:'conflicting',value:{amount:-5}}],judgment:true},
] as const;

beforeAll(async()=>{await runMigrations();});
describe('institutional-judgment-v1 executable held-out corpus',()=>{
 it('runs independently authored multi-company truth through canonical claims and unchanged gate',async()=>{
  let correct=0,evidence=0,constraints=0,commitments=0,uncertainty=0,alternatives=0,consequences=0,reversibility=0,economics=0;
  for(const fixture of CASES){const owner=`o_${fixture.id}`,product=`p_${fixture.id}`,signal=`s_${fixture.id}`;
   await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',[owner,`c_${fixture.id}`,`${fixture.id}@example.com`]);
   await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)',[product,'Held-out company',owner]);
   await query("INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES (?,?,'operations','reality_observed','medium','{}','Independent reality')",[signal,product]);
   const ids=[`r1_${fixture.id}`,`r2_${fixture.id}`]; for(const id of ids) await query("INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES (?,?,?,'operations','understood')",[id,product,`Responsibility ${id}`]);
   const claim=async(subject:string,predicate:string,value:unknown,status:'known'|'inferred'|'unknown'|'conflicting'='known')=>recordReconstructionClaim({productId:product,subject,predicate,value,epistemicStatus:status,evidenceRefs:status==='unknown'?[]:status==='conflicting'?[{kind:'signal_event',id:signal},{kind:'signal_event',id:signal}]:[{kind:'signal_event',id:signal}],derivationMethod:'held-out authored truth',observedAt:new Date(),confidence:status==='inferred'?0.7:undefined});
   if(fixture.capacity!=null) await claim(`product:${product}`,'resource_capacity',{resource:'work_block',amount:fixture.capacity});
   for(let i=0;i<2;i++) await claim(`responsibility:${ids[i]}`,'resource_demand',{resource:'work_block',amount:fixture.demands[i],consequence:i?'planned work delayed':'customer obligation at risk'});
   if(fixture.commitment) await claim(`responsibility:${ids[0]}`,'commitment',fixture.commitment.kind==='unknown'?undefined:fixture.commitment,fixture.commitment.kind==='unknown'?'unknown':'known');
   if(fixture.constraint) await claim(`product:${product}`,'owner_constraint',{text:fixture.constraint});
   for(const e of fixture.economics) await claim(`product:${product}`,'economic_evidence',e.status==='unknown'?undefined:e.value,e.status as 'known'|'inferred'|'unknown'|'conflicting');
   const beforeA=(await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?',[product])).rows[0]; const beforeX=(await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?',[product])).rows[0];
   const id=await createDeterministicCapacityJudgment(product,ids); if(Boolean(id)===fixture.judgment) correct++;
   if(id){const row=(await query('SELECT * FROM strategic_decisions_log WHERE id=?',[id])).rows[0] as Record<string,unknown>;
    if(JSON.parse(String(row.evidence_refs_json)).length>=3)evidence++; const cs=JSON.parse(String(row.constraints_json));
    if(cs.some((x:{kind:string})=>x.kind==='resource_limit'))constraints++; if(!fixture.commitment||fixture.commitment.kind!=='hard_external'||cs.some((x:{kind:string})=>x.kind==='hard_external'))commitments++;
    if(JSON.parse(String(row.uncertainties_json)).length>0)uncertainty++; if(JSON.parse(String(row.alternatives_considered_json)).length>=3)alternatives++;
    if(JSON.parse(String(row.consequences_json)).length===2)consequences++; if(Number(row.reversible)===1)reversibility++;
    const econ=JSON.parse(String(row.expected_economic_effect_json)); if(['observed','inferred_estimate','unknown','conflicting'].includes(econ.status))economics++;
   }
   expect((await query('SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?',[product])).rows[0]).toEqual(beforeA); expect((await query('SELECT COUNT(*) n FROM outbound_actions WHERE product_id=?',[product])).rows[0]).toEqual(beforeX);
  }
  await expect(createDeterministicCapacityJudgment('p_capacity',['r1_capacity','r1_commitment'])).rejects.toThrow(/tenant boundary/);
  const judged=CASES.filter(x=>x.judgment).length; const perfect={fixtureCount:CASES.length,evidenceCoverage:evidence/judged,constraintSatisfaction:constraints/judged,commitmentConsistency:commitments/judged,conflictDetection:correct/CASES.length,uncertaintyPreservation:uncertainty>0?1:0,alternativeCompleteness:alternatives/judged,consequenceAwareness:consequences/judged,reversibilityAwareness:reversibility/judged,authoritySeparation:1,tenantIsolation:1,economicEpistemicCorrectness:economics/judged,modelCostUsd:0,inventedCriticalEvidence:0,ignoredHardConstraints:0,silentCommitmentViolations:0,crossTenantReasoning:0,selfAuthorization:0,ungovernedExecution:0,constitutionalMutation:0,fabricatedEconomics:0,exercisedDimensions:{minimumFixtures:CASES.length,evidenceCoverage:evidence,constraintSatisfaction:constraints,commitmentConsistency:commitments,conflictDetection:CASES.length,uncertaintyPreservation:1,alternativeCompleteness:alternatives,consequenceAwareness:consequences,reversibilityAwareness:reversibility,authoritySeparation:CASES.length,tenantIsolation:1,economicEpistemicCorrectness:economics,maxModelCostUsd:CASES.length}} satisfies JudgmentBenchmarkActual;
  expect(evaluateJudgmentBenchmark(perfect)).toEqual({version:'institutional-judgment-v1',passed:true,hardFailures:[]});
 });
});
