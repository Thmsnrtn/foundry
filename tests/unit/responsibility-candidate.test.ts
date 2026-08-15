process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { decideResponsibilityCandidate,discoverCandidatesFromReconstruction,promoteResponsibilityCandidate,proposeResponsibilityCandidate,
  supersedeResponsibilityCandidate } from '../../src/services/institution/responsibility-candidate.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';

let groundedClaim:string, conflictingClaim:string;
beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('cand_owner','cand_clerk','candidate@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('cand_a','Candidate A','cand_owner'),('cand_b','Candidate B','cand_owner')",[]);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('cand_signal','cand_a','manual','support_spike','medium','{}','Support queues rising'),
    ('cand_signal_2','cand_a','manual','support_spike','medium','{}','Team reports normal'),
    ('cand_foreign','cand_b','manual','support_spike','medium','{}','Other product')`,[]);
  groundedClaim=await recordReconstructionClaim({productId:'cand_a',subject:'support',predicate:'capacity',value:'strained',
    epistemicStatus:'inferred',confidence:.8,evidenceRefs:[{kind:'signal_event',id:'cand_signal'}],derivationMethod:'bounded rule',observedAt:new Date()});
  conflictingClaim=await recordReconstructionClaim({productId:'cand_a',subject:'support',predicate:'health',value:['strained','normal'],
    epistemicStatus:'conflicting',evidenceRefs:[{kind:'signal_event',id:'cand_signal'},{kind:'signal_event',id:'cand_signal_2'}],derivationMethod:'comparison',observedAt:new Date()});
});

describe('append-only candidate lifecycle',()=>{
  it('rejects idempotently, blocks promotion, and permits explicit owner reconsideration',async()=>{
    const candidate=await proposeResponsibilityCandidate({...base(),convergenceKey:'support:lifecycle-reject',
      epistemicStatus:'known',confidence:undefined,evidenceRefs:[{kind:'signal_event',id:'cand_signal'}]});
    await Promise.all(Array.from({length:3},()=>decideResponsibilityCandidate({productId:'cand_a',candidateId:candidate.id,
      decision:'rejected',ownerId:'cand_owner',reason:'Not a responsibility we recognize'})));
    expect((await query("SELECT COUNT(*) n FROM responsibility_candidate_decisions WHERE candidate_id=? AND decision='rejected'",[candidate.id])).rows[0]).toMatchObject({n:1});
    await expect(promoteResponsibilityCandidate({productId:'cand_a',candidateId:candidate.id,
      mechanism:'authenticated_owner',ownerId:'cand_owner'})).rejects.toThrow();
    await expect(decideResponsibilityCandidate({productId:'cand_a',candidateId:candidate.id,
      decision:'reconsidered',ownerId:'forged',reason:'Try again'})).rejects.toThrow();
    await decideResponsibilityCandidate({productId:'cand_a',candidateId:candidate.id,
      decision:'reconsidered',ownerId:'cand_owner',reason:'Owner explicitly reopens after review'});
    const current=await query('SELECT status FROM responsibility_candidates WHERE id=?',[candidate.id]);
    expect(current.rows[0]).toMatchObject({status:'pending'});
    const history=await query('SELECT decision FROM responsibility_candidate_decisions WHERE candidate_id=? ORDER BY rowid',[candidate.id]);
    expect(history.rows.map((row)=>row.decision)).toEqual(['rejected','reconsidered']);
  });

  it('supersedes only with a pending same-product replacement and preserves both candidates',async()=>{
    const old=await proposeResponsibilityCandidate({...base(),convergenceKey:'support:old-response',
      epistemicStatus:'known',confidence:undefined,evidenceRefs:[{kind:'signal_event',id:'cand_signal'}]});
    const replacement=await proposeResponsibilityCandidate({...base(),convergenceKey:'support:new-response',
      proposedResponsibility:'Restore support capacity with an incident response',epistemicStatus:'known',confidence:undefined,
      evidenceRefs:[{kind:'signal_event',id:'cand_signal_2'}]});
    await supersedeResponsibilityCandidate({productId:'cand_a',candidateId:old.id,replacementCandidateId:replacement.id,
      ownerId:'cand_owner',reason:'New evidence distinguishes the incident response'});
    await supersedeResponsibilityCandidate({productId:'cand_a',candidateId:old.id,replacementCandidateId:replacement.id,
      ownerId:'cand_owner',reason:'Replay'});
    await expect(promoteResponsibilityCandidate({productId:'cand_a',candidateId:old.id,
      mechanism:'authenticated_owner',ownerId:'cand_owner'})).rejects.toThrow();
    const rows=await query('SELECT id,status FROM responsibility_candidates WHERE id IN (?,?) ORDER BY id',[old.id,replacement.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find((row)=>row.id===old.id)).toMatchObject({status:'superseded'});
    expect(rows.rows.find((row)=>row.id===replacement.id)).toMatchObject({status:'pending'});
    expect((await query("SELECT COUNT(*) n FROM responsibility_candidate_decisions WHERE candidate_id=? AND decision='superseded'",[old.id])).rows[0]).toMatchObject({n:1});
  });
});

describe('bounded reconstruction candidate discovery',()=>{
  it('discovers explicit grounded responsibility claims, converges replay, and abstains on unknowns',async()=>{
    const claim=await recordReconstructionClaim({productId:'cand_a',subject:'customer_support',
      predicate:'operational_responsibility',value:{title:'Restore customer support capacity',capability:'customer_support',authorityRequired:true},
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'cand_signal'}],
      derivationMethod:'typed support capacity rule',observedAt:new Date()});
    await recordReconstructionClaim({productId:'cand_a',subject:'unknown_work',predicate:'operational_responsibility',
      epistemicStatus:'unknown',derivationMethod:'explicit abstention',observedAt:new Date()});
    const [first,second]=await Promise.all([discoverCandidatesFromReconstruction('cand_a'),discoverCandidatesFromReconstruction('cand_a')]);
    const ids=[...first,...second].filter((candidate)=>candidate.evidenceRefs[0]?.id===claim).map((candidate)=>candidate.id);
    expect(new Set(ids).size).toBe(1);
    expect(first.some((candidate)=>candidate.proposedResponsibility==='Restore customer support capacity')).toBe(true);
    expect(first.some((candidate)=>candidate.proposedResponsibility.includes('unknown'))).toBe(false);
  });

  it('retains stale responsibility evidence as unresolved and unpromotable',async()=>{
    const staleClaim=await recordReconstructionClaim({productId:'cand_a',subject:'billing',predicate:'operational_responsibility',
      value:{title:'Reconcile legacy billing failures',capability:'billing_recovery'},epistemicStatus:'known',
      evidenceRefs:[{kind:'signal_event',id:'cand_signal'}],derivationMethod:'typed billing rule',
      observedAt:new Date('2025-01-01'),validUntil:new Date('2025-01-02')});
    const candidates=await discoverCandidatesFromReconstruction('cand_a',new Date('2026-01-01'));
    const candidate=candidates.find((item)=>item.evidenceRefs[0]?.id===staleClaim);
    expect(candidate).toMatchObject({epistemicStatus:'unresolved',status:'pending'});
    await expect(promoteResponsibilityCandidate({productId:'cand_a',candidateId:candidate!.id,
      mechanism:'authenticated_owner',ownerId:'cand_owner'})).rejects.toThrow();
  });
});

const base=()=>({productId:'cand_a',convergenceKey:'support:restore-capacity',proposedResponsibility:'Restore support capacity',
  evidenceRefs:[{kind:'reconstruction_claim' as const,id:groundedClaim}],derivationMethod:'bounded capacity interpretation',
  rationale:'Observed capacity strain may require an owned response',epistemicStatus:'inferred' as const,confidence:.8,
  capabilityDependency:'customer_support',authorityRequired:true,observedAt:new Date()});

describe('responsibility candidate boundary',()=>{
  it('creates a provenance-bearing candidate without responsibility, authority, policy, action, or execution',async()=>{
    const before=await Promise.all(['institutional_responsibilities','autonomy_consents','action_executions'].map((t)=>query(`SELECT COUNT(*) n FROM ${t}`,[])));
    const candidate=await proposeResponsibilityCandidate(base());
    expect(candidate).toMatchObject({productId:'cand_a',status:'pending',authorityRequired:true,confidence:.8});
    const after=await Promise.all(['institutional_responsibilities','autonomy_consents','action_executions'].map((t)=>query(`SELECT COUNT(*) n FROM ${t}`,[])));
    expect(after.map((r)=>Number((r.rows[0] as Record<string,unknown>).n))).toEqual(before.map((r)=>Number((r.rows[0] as Record<string,unknown>).n)));
  });
  it('converges replay and concurrency on product-scoped institutional meaning',async()=>{
    const [a,b,c]=await Promise.all([proposeResponsibilityCandidate(base()),proposeResponsibilityCandidate(base()),proposeResponsibilityCandidate(base())]);
    expect(new Set([a.id,b.id,c.id]).size).toBe(1);
    const rows=await query("SELECT COUNT(*) n FROM responsibility_candidates WHERE product_id='cand_a' AND convergence_key='support:restore-capacity'",[]);
    expect(Number((rows.rows[0] as Record<string,unknown>).n)).toBe(1);
  });
  it('rejects nonexistent, cross-product, model-only, and positive conflict evidence',async()=>{
    await expect(proposeResponsibilityCandidate({...base(),convergenceKey:'missing',evidenceRefs:[{kind:'reconstruction_claim',id:'missing'}]})).rejects.toThrow();
    await expect(proposeResponsibilityCandidate({...base(),convergenceKey:'foreign',evidenceRefs:[{kind:'signal_event',id:'cand_foreign'}]})).rejects.toThrow();
    await expect(proposeResponsibilityCandidate({...base(),convergenceKey:'conflict',evidenceRefs:[{kind:'reconstruction_claim',id:conflictingClaim}]})).rejects.toThrow();
    await expect(query(`INSERT INTO responsibility_candidates
      (id,product_id,convergence_key,proposed_responsibility,evidence_refs_json,derivation_method,rationale,epistemic_status,observed_at)
      VALUES ('model','cand_a','model','Do something','[{"kind":"model_assertion","id":"x"}]','model','plausible','known','2026-01-01')`,[])).rejects.toThrow();
  });
  it('allows conflict only as explicitly unresolved, never positive grounding',async()=>{
    const candidate=await proposeResponsibilityCandidate({...base(),convergenceKey:'support:unresolved-health',
      evidenceRefs:[{kind:'reconstruction_claim',id:conflictingClaim}],epistemicStatus:'unresolved',confidence:undefined});
    expect(candidate.epistemicStatus).toBe('unresolved');
  });
  it('converges authenticated owner promotion on one Visible responsibility and no authority',async()=>{
    const candidate=await proposeResponsibilityCandidate(base());
    const before=await Promise.all(['autonomy_consents','action_executions'].map((t)=>query(`SELECT COUNT(*) n FROM ${t}`,[])));
    const ids=await Promise.all(Array.from({length:4},()=>promoteResponsibilityCandidate({productId:'cand_a',candidateId:candidate.id,mechanism:'authenticated_owner',ownerId:'cand_owner'})));
    expect(new Set(ids).size).toBe(1);
    const responsibility=await query('SELECT state,authority_ref,outcome_ref FROM institutional_responsibilities WHERE id=?',[ids[0]]);
    expect(responsibility.rows[0]).toMatchObject({state:'visible',authority_ref:null,outcome_ref:null});
    expect((await query("SELECT COUNT(*) n FROM responsibility_candidate_decisions WHERE candidate_id=? AND decision='promoted'",[candidate.id])).rows[0]).toMatchObject({n:1});
    expect((await query('SELECT COUNT(*) n FROM responsibility_transitions WHERE responsibility_id=?',[ids[0]])).rows[0]).toMatchObject({n:1});
    const after=await Promise.all(['autonomy_consents','action_executions'].map((t)=>query(`SELECT COUNT(*) n FROM ${t}`,[])));
    expect(after.map((r)=>r.rows[0])).toEqual(before.map((r)=>r.rows[0]));
  });
  it('refuses forged owner and unresolved promotion',async()=>{
    const known=await proposeResponsibilityCandidate({...base(),convergenceKey:'support:known-direct',epistemicStatus:'known',confidence:undefined,evidenceRefs:[{kind:'signal_event',id:'cand_signal'}]});
    await expect(promoteResponsibilityCandidate({productId:'cand_a',candidateId:known.id,mechanism:'authenticated_owner',ownerId:'forged'})).rejects.toThrow();
    const unresolved=await query("SELECT id FROM responsibility_candidates WHERE convergence_key='support:unresolved-health'",[]);
    await expect(promoteResponsibilityCandidate({productId:'cand_a',candidateId:String((unresolved.rows[0] as Record<string,unknown>).id),mechanism:'authenticated_owner',ownerId:'cand_owner'})).rejects.toThrow();
    expect((await query("SELECT COUNT(*) n FROM institutional_responsibilities WHERE id LIKE 'candidate_%'",[])).rows[0]).toMatchObject({n:1});
  });
});
