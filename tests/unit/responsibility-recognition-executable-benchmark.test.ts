process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim,reconstructCompany } from '../../src/services/institution/reconstruction.js';
import { discoverCandidatesFromReconstruction,promoteResponsibilityCandidate } from '../../src/services/institution/responsibility-candidate.js';
import { evaluateE3ResponsibilityRecognitionGate,scoreResponsibilityRecognition,
  type RecognitionActual,type RecognitionTruth } from '../../src/services/institution/responsibility-recognition-benchmark.js';

const truths:RecognitionTruth[]=[
  {productId:'recognition_saas',expectedCandidates:['Restore deployment reliability'],expectedResponsibilities:['Restore deployment reliability'],shouldAbstain:false},
  {productId:'recognition_service',expectedCandidates:['Maintain dispatch coverage'],expectedResponsibilities:['Maintain dispatch coverage'],shouldAbstain:false},
  {productId:'recognition_conflict',expectedCandidates:['Reconcile fulfillment ownership'],expectedResponsibilities:[],shouldAbstain:true},
  {productId:'recognition_unknown',expectedCandidates:[],expectedResponsibilities:[],shouldAbstain:true},
  {productId:'recognition_stale',expectedCandidates:['Review legacy billing recovery'],expectedResponsibilities:[],shouldAbstain:true},
];

async function actual(productId:string):Promise<RecognitionActual> {
  const candidates=await query(`SELECT id,product_id,proposed_responsibility,status,epistemic_status,evidence_refs_json
    FROM responsibility_candidates WHERE product_id=?`,[productId]);
  const responsibilities=await query(`SELECT product_id,title,state,authority_ref FROM institutional_responsibilities WHERE product_id=?`,[productId]);
  const promotions=await query(`SELECT candidate_id FROM responsibility_candidate_decisions WHERE product_id=? AND decision='promoted'`,[productId]);
  return {
    candidates:(candidates.rows as unknown as Array<Record<string,unknown>>).map((row)=>({id:String(row.id),productId:String(row.product_id),
      title:String(row.proposed_responsibility),status:String(row.status),epistemicStatus:String(row.epistemic_status),
      evidenceCount:(JSON.parse(String(row.evidence_refs_json)) as unknown[]).length})),
    responsibilities:(responsibilities.rows as unknown as Array<Record<string,unknown>>).map((row)=>({
      productId:String(row.product_id),title:String(row.title),state:String(row.state),
      authorityRef:row.authority_ref==null?null:String(row.authority_ref),
    })),
    promotionCandidateIds:promotions.rows.map((row)=>String(row.candidate_id)),createdConsentCount:0,createdExecutionCount:0,
  };
}

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('recognition_owner','recognition_clerk','recognition@example.com'),('recognition_foreign_owner','recognition_foreign_clerk','foreign@example.com')",[]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('recognition_saas','Deploy Systems','recognition_owner'),('recognition_service','Dispatch Works','recognition_owner'),
    ('recognition_conflict','Fulfillment Works','recognition_owner'),('recognition_unknown','Unknown Works','recognition_owner'),
    ('recognition_stale','Legacy Billing','recognition_owner'),('recognition_foreign','Foreign Works','recognition_foreign_owner')`,[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('recognition_deploy','recognition_saas','github','deployment_failed','high','{}','Deployment failed'),
    ('recognition_dispatch','recognition_service','dispatch','coverage_gap','high','{}','Shift uncovered'),
    ('recognition_conflict_a','recognition_conflict','warehouse','owner_changed','medium','{}','Operations owns it'),
    ('recognition_conflict_b','recognition_conflict','manual','owner_changed','medium','{}','Support owns it'),
    ('recognition_stale_signal','recognition_stale','stripe','payment_failed','medium','{}','Old failure'),
    ('recognition_foreign_signal','recognition_foreign','manual','secret','high','{}','Foreign evidence')`,[]);
  const knownInputs=[
    {productId:'recognition_saas',subject:'deployments',title:'Restore deployment reliability',capability:'development',signal:'recognition_deploy'},
    {productId:'recognition_service',subject:'dispatch',title:'Maintain dispatch coverage',capability:'operations',signal:'recognition_dispatch'},
  ];
  for (const input of knownInputs) await recordReconstructionClaim({productId:input.productId,subject:input.subject,
    predicate:'operational_responsibility',value:{title:input.title,capability:input.capability},epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:input.signal}],derivationMethod:'typed held-out operating rule',observedAt:new Date('2026-08-14')});
  await recordReconstructionClaim({productId:'recognition_conflict',subject:'fulfillment',predicate:'operational_responsibility',
    value:{title:'Reconcile fulfillment ownership',capability:'operations'},epistemicStatus:'conflicting',
    evidenceRefs:[{kind:'signal_event',id:'recognition_conflict_a'},{kind:'signal_event',id:'recognition_conflict_b'}],
    derivationMethod:'unresolved independent sources',observedAt:new Date('2026-08-14')});
  await recordReconstructionClaim({productId:'recognition_unknown',subject:'company',predicate:'operational_responsibility',
    epistemicStatus:'unknown',derivationMethod:'explicit unknown',observedAt:new Date('2026-08-14')});
  await recordReconstructionClaim({productId:'recognition_stale',subject:'billing',predicate:'operational_responsibility',
    value:{title:'Review legacy billing recovery',capability:'billing_recovery'},epistemicStatus:'known',
    evidenceRefs:[{kind:'signal_event',id:'recognition_stale_signal'}],derivationMethod:'typed historical rule',
    observedAt:new Date('2025-01-01'),validUntil:new Date('2025-02-01')});
});

describe('executable responsibility-recognition benchmark',()=>{
  it('runs ordinary evidence through reconstruction, discovery, promotion, and the prospective gate',async()=>{
    const now=new Date('2026-08-14');
    for (const truth of truths) {
      await reconstructCompany(truth.productId,now);
      const candidates=await discoverCandidatesFromReconstruction(truth.productId,now);
      await discoverCandidatesFromReconstruction(truth.productId,now);
      for (const candidate of candidates.filter((item)=>item.epistemicStatus==='known')) {
        await promoteResponsibilityCandidate({productId:truth.productId,candidateId:candidate.id,mechanism:'deterministic'});
      }
    }
    const results=[];
    for (const truth of truths) results.push(scoreResponsibilityRecognition(await actual(truth.productId),truth));
    expect(evaluateE3ResponsibilityRecognitionGate(results)).toEqual({passed:true,reasons:[]});
    expect(JSON.stringify(await actual('recognition_saas'))).not.toContain('recognition_foreign');
  });

  it('fails hard regardless of averages when authority or maturity is fabricated',()=>{
    const truth=truths[0];
    const result=scoreResponsibilityRecognition({candidates:[{id:'x',productId:truth.productId,title:'Restore deployment reliability',
      status:'promoted',epistemicStatus:'known',evidenceCount:1}],promotionCandidateIds:['x'],createdConsentCount:1,createdExecutionCount:1,
      responsibilities:[{productId:truth.productId,title:'Restore deployment reliability',state:'operating',authorityRef:'forged'}]},truth);
    expect(result.hardFailures).toEqual(expect.arrayContaining(['candidate_created_authority_or_execution','unjustified_initial_state']));
    expect(evaluateE3ResponsibilityRecognitionGate([result,result,result,result])).toMatchObject({passed:false});
  });
});
