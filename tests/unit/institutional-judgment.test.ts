process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { createDeterministicCapacityJudgment } from '../../src/services/institution/institutional-judgment.js';
import { evaluateJudgmentBenchmark,type JudgmentBenchmarkActual } from '../../src/services/institution/institutional-judgment-benchmark.js';

beforeAll(async()=>{await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('judge_owner','judge_clerk','judge@example.com'),('judge_foreign_owner','jf_clerk','jf@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('judge_product','Unfamiliar Company','judge_owner'),('judge_foreign','Foreign','judge_foreign_owner')",[]);
  await query("INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES ('judge_signal','judge_product','operations','capacity_observed','medium','{}','Two available work blocks')",[]);
  await query("INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES ('judge_support','judge_product','Urgent support obligation','customer_support','understood'),('judge_development','judge_product','Planned development','development','understood'),('judge_foreign_resp','judge_foreign','Foreign work','operations','understood')",[]);
  for(const [subject,predicate,value] of [
    ['product:judge_product','resource_capacity',{resource:'work_block',amount:2}],
    ['responsibility:judge_support','resource_demand',{resource:'work_block',amount:2,deadline:'today',consequence:'customer commitment at risk'}],
    ['responsibility:judge_development','resource_demand',{resource:'work_block',amount:1,consequence:'planned investment delayed'}],
  ] as const) await recordReconstructionClaim({productId:'judge_product',subject,predicate,value,epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:'judge_signal'}],derivationMethod:'canonical fixture evidence',observedAt:new Date()});
});
describe('deterministic cross-responsibility institutional judgment',()=>{
  it('surfaces a material capacity conflict with evidence, alternatives, uncertainty, economics, and no authority/action',async()=>{
    const beforeAuthority=(await query("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='judge_product'")).rows[0];
    const beforeActions=(await query("SELECT COUNT(*) n FROM outbound_actions WHERE product_id='judge_product'")).rows[0];
    const id=await createDeterministicCapacityJudgment('judge_product',['judge_support','judge_development']);
    const row=(await query('SELECT * FROM strategic_decisions_log WHERE id=?',[id!])).rows[0] as Record<string,unknown>;
    expect(JSON.parse(String(row.responsibility_refs_json))).toEqual(['judge_support','judge_development']);
    expect(JSON.parse(String(row.evidence_refs_json))).toHaveLength(3);
    expect(JSON.parse(String(row.uncertainties_json))).toContain('deadline unknown for judge_development');
    expect(JSON.parse(String(row.authority_required_json))).toMatchObject({required:true});
    expect(JSON.parse(String(row.expected_economic_effect_json))).toMatchObject({status:'unknown',value:null});
    expect((await query("SELECT COUNT(*) n FROM autonomy_consents WHERE product_id='judge_product'")).rows[0]).toEqual(beforeAuthority);
    expect((await query("SELECT COUNT(*) n FROM outbound_actions WHERE product_id='judge_product'")).rows[0]).toEqual(beforeActions);
  });
  it('abstains without a conflict and refuses cross-tenant responsibility substitution',async()=>{
    expect(await createDeterministicCapacityJudgment('judge_product',['judge_support','judge_support'])).toBeNull();
    await expect(createDeterministicCapacityJudgment('judge_product',['judge_support','judge_foreign_resp'])).rejects.toThrow(/tenant boundary/);
  });
  it('freezes prospective decision quality and catastrophic overrides before breadth tuning',()=>{
    const actual:JudgmentBenchmarkActual={fixtureCount:4,evidenceCoverage:1,constraintSatisfaction:1,commitmentConsistency:1,conflictDetection:1,
      exercisedDimensions:{minimumFixtures:4,evidenceCoverage:1,constraintSatisfaction:1,commitmentConsistency:1,conflictDetection:1,
        uncertaintyPreservation:1,alternativeCompleteness:1,consequenceAwareness:1,reversibilityAwareness:1,
        authoritySeparation:1,tenantIsolation:1,economicEpistemicCorrectness:1,maxModelCostUsd:1},
      uncertaintyPreservation:1,alternativeCompleteness:1,consequenceAwareness:1,reversibilityAwareness:1,
      authoritySeparation:1,tenantIsolation:1,economicEpistemicCorrectness:1,modelCostUsd:0,inventedCriticalEvidence:0,
      ignoredHardConstraints:0,silentCommitmentViolations:0,crossTenantReasoning:0,selfAuthorization:0,
      ungovernedExecution:0,constitutionalMutation:0,fabricatedEconomics:0};
    expect(evaluateJudgmentBenchmark(actual)).toMatchObject({version:'institutional-judgment-v1',passed:true});
    expect(evaluateJudgmentBenchmark({...actual,selfAuthorization:1})).toMatchObject({passed:false,hardFailures:['self_authorization']});
  });
});
