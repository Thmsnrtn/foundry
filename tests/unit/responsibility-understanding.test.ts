process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding,projectResponsibilityUnderstanding,
  type UnderstandingFact } from '../../src/services/institution/responsibility-understanding.js';

const facts:Record<UnderstandingFact,unknown>={
  purpose:'Keep customers able to use the service',desired_outcome:'Support response capacity meets current demand',
  success_conditions:['queue within staffed capacity'],operating_constraints:['no customer data disclosure'],
  dependencies:['support queue','staff schedule'],risks:['material customer churn'],
};

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('under_owner','under_clerk','under@example.com'),('under_foreign_owner','under_foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('under_product','Support Company','under_owner'),('under_foreign','Foreign','under_foreign_owner')",[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('under_signal','under_product','company_observation_baseline','company_observation_baseline:support_queue','low','{}','Support demand exceeds capacity'),
    ('under_foreign_signal','under_foreign','company_observation_baseline','company_observation_baseline:support_queue','low','{}','Foreign')`,[]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES ('under_resp','under_product','Restore support response capacity','customer_support','visible')`,[]);
});

describe('earned responsibility understanding',()=>{
  it('preserves missing critical facts and refuses a persuasive but incomplete model',async()=>{
    await recordReconstructionClaim({productId:'under_product',subject:'responsibility:under_resp',predicate:'purpose',
      value:facts.purpose,epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'under_signal'}],
      derivationMethod:'bounded support rule',observedAt:new Date()});
    const projection=await projectResponsibilityUnderstanding('under_product','under_resp');
    expect(projection.missingCriticalFacts).toEqual(expect.arrayContaining(['desired_outcome','dependencies','operating_constraints']));
    await expect(earnResponsibilityUnderstanding('under_product','under_resp')).rejects.toThrow(/insufficient/);
  });

  it('earns Visible to Understood only after every critical fact is current and grounded',async()=>{
    for (const [predicate,value] of Object.entries(facts) as Array<[UnderstandingFact,unknown]>) {
      if (predicate==='purpose') continue;
      await recordReconstructionClaim({productId:'under_product',subject:'responsibility:under_resp',predicate,value,
        epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'under_signal'}],
        derivationMethod:'bounded support operating model',observedAt:new Date()});
    }
    const responsibility=await earnResponsibilityUnderstanding('under_product','under_resp');
    expect(responsibility).toMatchObject({state:'understood',authorityRef:null});
    const transition=await query(`SELECT from_state,to_state,authority_ref,actor_ref FROM responsibility_transitions
      WHERE responsibility_id='under_resp'`);
    expect(transition.rows).toEqual([expect.objectContaining({from_state:'visible',to_state:'understood',authority_ref:null,
      actor_ref:'institution:responsibility_understanding_verifier'})]);
  });

  it('refuses stale, conflicting, fabricated, and cross-tenant understanding evidence',async()=>{
    await query("INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES ('under_blocked','under_product','Blocked work','general','visible')",[]);
    await recordReconstructionClaim({productId:'under_product',subject:'responsibility:under_blocked',predicate:'purpose',value:'Old purpose',
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'under_signal'}],derivationMethod:'old evidence',
      observedAt:new Date('2025-01-01'),validUntil:new Date('2025-02-01')});
    await recordReconstructionClaim({productId:'under_product',subject:'responsibility:under_blocked',predicate:'desired_outcome',value:['a','b'],
      epistemicStatus:'conflicting',evidenceRefs:[{kind:'signal_event',id:'under_signal'},{kind:'signal_event',id:'under_signal'}],
      derivationMethod:'conflict',observedAt:new Date()});
    const projection=await projectResponsibilityUnderstanding('under_product','under_blocked',new Date('2026-01-01'));
    expect(projection.unresolvedFacts).toEqual(expect.arrayContaining(['purpose','desired_outcome']));
    await expect(earnResponsibilityUnderstanding('under_product','under_blocked',new Date('2026-01-01'))).rejects.toThrow(/insufficient/);
    await expect(recordReconstructionClaim({productId:'under_product',subject:'responsibility:under_blocked',predicate:'dependencies',value:['foreign'],
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'under_foreign_signal'}],derivationMethod:'attack',observedAt:new Date()})).rejects.toThrow();
  });
});
