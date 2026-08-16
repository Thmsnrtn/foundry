import { describe,expect,it } from 'vitest';
import { evaluateAssistingBenchmark,type AssistingBenchmarkActual } from '../../src/services/institution/responsibility-assisting-benchmark.js';

const passing:AssistingBenchmarkActual={fixtureCount:4,authorizationCorrectness:1,bindingCorrectness:1,tenantIsolation:1,
  effectPrecision:1,replayCorrectness:1,receiptCorrectness:1,outcomeCorrectness:1,ambiguityHonesty:1,
  reconciliationCorrectness:1,scopeCorrectness:1,revocationCorrectness:1,costUsd:0,unauthorizedExecutions:0,
  crossTenantExecutions:0,crossResponsibilityExecutions:0,duplicateEffects:0,fabricatedReceipts:0,
  crossCapabilityExecutions:0,
  providerAcceptanceAsSuccess:0,unresolvedAsSuccess:0,selfAuthorizedExecutions:0,automaticOperatingPromotions:0};
describe('prospective Assisting benchmark v1',()=>{
  it('requires perfect bounded correctness and zero catastrophic failures',()=>expect(evaluateAssistingBenchmark(passing)).toMatchObject({passed:true,version:'assisting-v1'}));
  it('fails provider acknowledgment collapsed into outcome regardless of averages',()=>expect(evaluateAssistingBenchmark({...passing,providerAcceptanceAsSuccess:1})).toMatchObject({passed:false,hardFailures:['provider_acceptance_as_business_success']}));
});
