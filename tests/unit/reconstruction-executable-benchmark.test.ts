process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reconstructCompany,recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { evaluateE3ReconstructionGate,scoreReconstruction,type ReconstructionFixtureTruth } from '../../src/services/institution/reconstruction-benchmark.js';

const truths:ReconstructionFixtureTruth[]=[
  {productId:'exe_saas',supportedClaims:[],expectedUnknowns:['company_purpose'],expectedConflicts:[],staleSystems:['github'],expectedResponsibilities:['Investigate failed deployments'],authorityByCapability:{development:false}},
  {productId:'exe_service',supportedClaims:[],expectedUnknowns:['company_purpose'],expectedConflicts:[],staleSystems:[],expectedResponsibilities:['Restore shift coverage'],authorityByCapability:{operations:false}},
  {productId:'exe_commerce',supportedClaims:[{subject:'fulfillment',predicate:'health',value:['delayed','normal'],epistemicStatus:'conflicting'}],expectedUnknowns:['company_purpose'],expectedConflicts:['fulfillment:health'],staleSystems:['warehouse'],expectedResponsibilities:['Investigate failed orders'],authorityByCapability:{commerce_operations:false}},
  {productId:'exe_sparse',supportedClaims:[],expectedUnknowns:['company_purpose'],expectedConflicts:[],staleSystems:[],expectedResponsibilities:[],authorityByCapability:{}},
  {productId:'exe_portfolio_a',supportedClaims:[],expectedUnknowns:['company_purpose'],expectedConflicts:[],staleSystems:[],expectedResponsibilities:['Reconcile shared support'],authorityByCapability:{customer_support:false}},
];

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('exe_owner','exe_clerk','exe@example.com'),('exe_foreign_owner','exe_foreign_clerk','foreign@example.com')",[]);
  await query(`INSERT INTO products (id,name,owner_id) VALUES
    ('exe_saas','Patchwork Cloud','exe_owner'),('exe_service','Night Shift Dispatch','exe_owner'),
    ('exe_commerce','Parcel Works','exe_owner'),('exe_sparse','Seedling Labs','exe_owner'),
    ('exe_portfolio_a','Northstar A','exe_owner'),('exe_portfolio_b','Northstar B','exe_owner'),
    ('exe_foreign','Foreign Company','exe_foreign_owner')`,[]);
  await query(`INSERT INTO integrations (id,product_id,type,status,name,last_synced_at) VALUES
    ('exe_git','exe_saas','inbound','active','github','2025-01-01'),
    ('exe_dispatch','exe_service','inbound','active','dispatch',NULL),
    ('exe_warehouse','exe_commerce','inbound','active','warehouse','2025-01-01'),
    ('exe_foreign_system','exe_foreign','inbound','active','secret-system','2026-08-01')`,[]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    ('exe_r_saas','exe_saas','Investigate failed deployments','development','visible'),
    ('exe_r_service','exe_service','Restore shift coverage','operations','visible'),
    ('exe_r_commerce','exe_commerce','Investigate failed orders','commerce_operations','visible'),
    ('exe_r_portfolio','exe_portfolio_a','Reconcile shared support','customer_support','visible'),
    -- The state used to be 'operating', which migration 115 froze and migration
    -- 159 now refuses at birth too. This fixture is about TENANCY, not about the
    -- rung: the only place in the codebase a responsibility was ever Operating
    -- was a test that did not need it to be.
    ('exe_r_foreign','exe_foreign','Foreign responsibility','operations','assisting')`,[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('exe_delayed','exe_commerce','warehouse','support_spike','high','{}','Fulfillment delayed'),
    ('exe_normal','exe_commerce','manual','support_spike','medium','{}','Team reports normal')`,[]);
  await recordReconstructionClaim({productId:'exe_commerce',subject:'fulfillment',predicate:'health',value:['delayed','normal'],epistemicStatus:'conflicting',
    evidenceRefs:[{kind:'signal_event',id:'exe_delayed'},{kind:'signal_event',id:'exe_normal'}],derivationMethod:'unreconciled canonical source comparison',observedAt:new Date('2026-08-01')});
});

describe('executable reconstruction benchmark',()=>{
  it('runs canonical ledgers through the real sparse reconstruction path and unchanged gate',async()=>{
    const now=new Date('2026-08-14');
    const outputs=await Promise.all(truths.map((truth)=>reconstructCompany(truth.productId,now)));
    const results=outputs.map((output,index)=>scoreReconstruction(output,truths[index]));
    expect(evaluateE3ReconstructionGate(results)).toEqual({passed:true,reasons:[]});
    expect(JSON.stringify(outputs)).not.toContain('Foreign responsibility');
    expect(JSON.stringify(outputs)).not.toContain('secret-system');
  });
});
