import type { CompanyReconstruction } from '../../src/services/institution/reconstruction.js';
import type { ReconstructionFixtureTruth } from '../../src/services/institution/reconstruction-benchmark.js';

type HeldOut={name:string;structure:string;truth:ReconstructionFixtureTruth;actual:CompanyReconstruction};
const fixture=(name:string,structure:string,productId:string,claim:[string,string,unknown],unknowns:string[],system?:[string,'known'|'stale'|'unknown']):HeldOut => {
  const [subject,predicate,value]=claim;
  const truth:ReconstructionFixtureTruth={productId,supportedClaims:[{subject,predicate,value,epistemicStatus:'known'}],
    expectedUnknowns:unknowns,expectedConflicts:[],staleSystems:system?.[1]==='stale'?[system[0]]:[],
    expectedResponsibilities:[],authorityByCapability:{}};
  return {name,structure,truth,actual:{identity:{productId,name,ownerId:`owner-${productId}`,evidenceRef:{kind:'product',id:productId}},
    systems:system?[{id:`system-${productId}`,name:system[0],status:'active',observedAt:system[1]==='unknown'?null:'2025-01-01',epistemicStatus:system[1]}]:[],
    responsibilities:[],claims:[{id:`claim-${productId}`,productId,subject,predicate,value,epistemicStatus:'known',confidence:null,
      evidenceRefs:[{kind:'signal_event',id:`signal-${productId}`}],derivationMethod:'deterministic held-out evidence',observedAt:'2026-01-01',validUntil:null}],unknowns}};
};

/** Truth is authored here, outside production reconstruction code. These cases
 * challenge scorer semantics; they are not executable ingestion/generalization proof. */
export const HELD_OUT_RECONSTRUCTION_CASES:HeldOut[]=[
  fixture('Patchwork Cloud','saas/software','held-saas',['deployments','failure_state','elevated'],['financial_state'],['github','stale']),
  fixture('Night Shift Dispatch','service/operations','held-service',['shifts','coverage','insufficient'],['responsibility_owner'],['dispatch','unknown']),
  fixture('Parcel Works','commerce/transaction','held-commerce',['orders','failure_rate','elevated'],['company_purpose'],['warehouse','stale']),
  fixture('Seedling Labs','sparse early-stage','held-sparse',['company','stage','pre-revenue'],['company_purpose','financial_state','responsibility_owner']),
  fixture('Northstar Portfolio','multi-product','held-portfolio',['portfolio','product_count',2],['shared_operating_owner'],['analytics','known']),
];
