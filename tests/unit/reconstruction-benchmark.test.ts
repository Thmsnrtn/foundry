import { describe,expect,it } from 'vitest';
import { E3_RECONSTRUCTION_GATE,evaluateE3ReconstructionGate,scoreReconstruction,type ReconstructionFixtureTruth } from '../../src/services/institution/reconstruction-benchmark.js';
import type { CompanyReconstruction } from '../../src/services/institution/reconstruction.js';
import { HELD_OUT_RECONSTRUCTION_CASES } from '../fixtures/reconstruction-held-out.js';

const truth:ReconstructionFixtureTruth={
  productId:'commerce-held-out',
  supportedClaims:[
    {subject:'orders',predicate:'failure_rate',value:'elevated',epistemicStatus:'known'},
    {subject:'fulfillment',predicate:'health',value:['delayed','normal'],epistemicStatus:'conflicting'},
  ],
  expectedUnknowns:['company_purpose'],expectedConflicts:['fulfillment:health'],staleSystems:['warehouse'],
  expectedResponsibilities:['Investigate failed orders'],authorityByCapability:{commerce_operations:false},
};
const good:CompanyReconstruction={
  identity:{productId:'commerce-held-out',name:'Parcel Works',ownerId:'owner',evidenceRef:{kind:'product',id:'commerce-held-out'}},
  systems:[{id:'w',name:'warehouse',status:'active',observedAt:'2020-01-01',epistemicStatus:'stale'}],
  responsibilities:[{id:'r',title:'Investigate failed orders',state:'visible',capability:'commerce_operations',owner:'unknown',activeAuthority:false}],
  claims:[
    {id:'c1',productId:'commerce-held-out',subject:'orders',predicate:'failure_rate',value:'elevated',epistemicStatus:'known',confidence:null,evidenceRefs:[{kind:'signal_event',id:'s1'}],derivationMethod:'rule',observedAt:'2026-01-01',validUntil:null},
    {id:'c2',productId:'commerce-held-out',subject:'fulfillment',predicate:'health',value:['delayed','normal'],epistemicStatus:'conflicting',confidence:null,evidenceRefs:[{kind:'signal_event',id:'s2'},{kind:'wiki_entry',id:'w2'}],derivationMethod:'comparison',observedAt:'2026-01-01',validUntil:null},
  ],unknowns:['company_purpose'],
};

describe('reconstruction benchmark v1',()=>{
  it('reports separate interpretable measures for a truthful held-out fixture',()=>{
    expect(scoreReconstruction(good,truth)).toEqual({supportedFactualPrecision:1,unsupportedClaimRate:0,provenanceCompleteness:1,
      unknownPreservation:1,conflictPreservation:1,staleStateCorrectness:1,tenantIsolationCorrect:true,
      responsibilityPrecision:1,falseResponsibilityDiscoveries:0,duplicateResponsibilities:0,authoritySeparationCorrect:true,hardFailures:[]});
  });
  it('hard-fails catastrophic defects regardless of otherwise good averages',()=>{
    const bad=structuredClone(good);
    bad.identity!.productId='other-tenant';
    bad.claims[0].evidenceRefs=[];
    bad.claims[1].epistemicStatus='known';
    bad.systems[0].epistemicStatus='known';
    bad.responsibilities.push({id:'bad',title:'Invented operation',state:'operating',capability:'commerce_operations',owner:'unknown',activeAuthority:true});
    expect(scoreReconstruction(bad,truth).hardFailures).toEqual(expect.arrayContaining([
      'cross_tenant_leakage','fabricated_or_missing_provenance','inferred_authority','conflict_not_preserved',
      'stale_consequential_data_treated_current','unsupported_operational_responsibility',
    ]));
  });
  it('defines a versioned E3 gate that cannot be satisfied by benchmark machinery alone',()=>{
    expect(E3_RECONSTRUCTION_GATE).toMatchObject({minimumHeldOutFixtures:4,requireZeroHardFailures:true,
      minimumUnknownPreservation:1,maximumFalseResponsibilityDiscoveries:0});
  });
  it('scores five structurally distinct independently specified held-out cases without averaging',()=>{
    const results=HELD_OUT_RECONSTRUCTION_CASES.map((fixture) => scoreReconstruction(fixture.actual,fixture.truth));
    expect(HELD_OUT_RECONSTRUCTION_CASES.map((fixture) => fixture.structure)).toEqual([
      'saas/software','service/operations','commerce/transaction','sparse early-stage','multi-product',
    ]);
    expect(evaluateE3ReconstructionGate(results)).toEqual({passed:true,reasons:[]});
  });
  it('the gate refuses insufficient breadth and names per-fixture defects',()=>{
    const result=scoreReconstruction(good,truth);
    expect(evaluateE3ReconstructionGate([result])).toEqual({passed:false,reasons:['requires_4_held_out_fixtures']});
    const broken={...result,hardFailures:['cross_tenant_leakage']};
    expect(evaluateE3ReconstructionGate([result,result,result,broken])).toMatchObject({passed:false});
  });
});
