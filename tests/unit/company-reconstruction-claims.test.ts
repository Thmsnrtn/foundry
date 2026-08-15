process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getReconstructionClaims, recordReconstructionClaim, reconstructCompany } from '../../src/services/institution/reconstruction.js';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('rc_owner','rc_clerk','rc@example.com'),('rc_other','rc_other_clerk','other@example.com')", []);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('rc_product','Unfamiliar Co','rc_owner'),('rc_foreign','Foreign Co','rc_other')", []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('rc_signal_a','rc_product','manual','support_spike','medium','{}','Support queue rising'),
    ('rc_signal_b','rc_product','manual','support_spike','medium','{}','Support team says normal'),
    ('rc_foreign_signal','rc_foreign','manual','support_spike','medium','{}','Foreign signal')`, []);
  await query(`INSERT INTO integrations (id,product_id,type,status,name,last_synced_at) VALUES
    ('rc_current_system','rc_product','inbound','active','stripe','2025-12-31'),
    ('rc_stale_system','rc_product','inbound','active','github','2025-01-01'),
    ('rc_foreign_system','rc_foreign','inbound','active','linear','2025-12-31')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state)
    VALUES ('rc_responsibility','rc_product','Restore support capacity','customer_support','visible'),
           ('rc_foreign_responsibility','rc_foreign','Foreign work','customer_support','visible')`, []);
});

describe('provenance-bearing reconstruction claims', () => {
  it('preserves known, inferred, unknown, conflicting, and read-time stale truth', async () => {
    await recordReconstructionClaim({ productId:'rc_product',subject:'support',predicate:'queue_state',value:'rising',
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'rc_signal_a'}],derivationMethod:'deterministic signal projection',observedAt:new Date('2026-01-01') });
    await recordReconstructionClaim({ productId:'rc_product',subject:'company',predicate:'purpose',
      epistemicStatus:'unknown',derivationMethod:'source inventory found no grounded purpose',observedAt:new Date('2026-01-01') });
    await recordReconstructionClaim({ productId:'rc_product',subject:'support',predicate:'capacity_risk',value:'elevated',
      epistemicStatus:'inferred',confidence:0.7,evidenceRefs:[{kind:'signal_event',id:'rc_signal_a'}],derivationMethod:'bounded support rule',observedAt:new Date('2026-01-01') });
    await recordReconstructionClaim({ productId:'rc_product',subject:'support',predicate:'current_health',value:['rising','normal'],
      epistemicStatus:'conflicting',evidenceRefs:[{kind:'signal_event',id:'rc_signal_a'},{kind:'signal_event',id:'rc_signal_b'}],derivationMethod:'unreconciled source comparison',observedAt:new Date('2026-01-01') });
    await recordReconstructionClaim({ productId:'rc_product',subject:'support',predicate:'on_call_owner',value:'team-a',
      epistemicStatus:'known',evidenceRefs:[{kind:'signal_event',id:'rc_signal_a'}],derivationMethod:'observed assignment',
      observedAt:new Date('2025-01-01'),validUntil:new Date('2025-02-01') });
    const claims = await getReconstructionClaims('rc_product',new Date('2026-01-01'));
    expect(Object.fromEntries(claims.map((claim) => [claim.predicate,claim.epistemicStatus]))).toEqual({
      queue_state:'known',purpose:'unknown',capacity_risk:'inferred',current_health:'conflicting',on_call_owner:'stale',
    });
    expect(claims.every((claim) => claim.productId==='rc_product')).toBe(true);
  });

  it('rejects fabricated, cross-tenant, model-only, and epistemically incomplete evidence', async () => {
    const base = { productId:'rc_product',subject:'company',predicate:'purpose',value:'Serve teams',
      epistemicStatus:'known' as const,derivationMethod:'test',observedAt:new Date() };
    await expect(recordReconstructionClaim({ ...base,evidenceRefs:[{kind:'signal_event',id:'missing'}] })).rejects.toThrow();
    await expect(recordReconstructionClaim({ ...base,evidenceRefs:[{kind:'signal_event',id:'rc_foreign_signal'}] })).rejects.toThrow();
    await expect(recordReconstructionClaim({ ...base,evidenceRefs:[] })).rejects.toThrow();
    await expect(recordReconstructionClaim({ ...base,epistemicStatus:'inferred',evidenceRefs:[{kind:'signal_event',id:'rc_signal_a'}] })).rejects.toThrow();
    await expect(query(`INSERT INTO reconstruction_claims
      (id,product_id,subject,predicate,value_json,epistemic_status,evidence_refs_json,derivation_method,observed_at)
      VALUES ('model_only','rc_product','company','purpose','"Serve teams"','known','[{"kind":"model_assertion","id":"x"}]','model','2026-01-01')`,[])).rejects.toThrow();
  });

  it('does not use reconstruction claims as recursive evidence or leak another product', async () => {
    const claims = await getReconstructionClaims('rc_foreign');
    expect(claims).toEqual([]);
    await expect(query(`INSERT INTO reconstruction_claims
      (id,product_id,subject,predicate,value_json,epistemic_status,evidence_refs_json,derivation_method,observed_at)
      VALUES ('recursive','rc_product','company','purpose','"x"','known','[{"kind":"reconstruction_claim","id":"anything"}]','copy','2026-01-01')`,[])).rejects.toThrow();
  });

  it('builds a sparse unfamiliar-company projection without copying or completing missing truth', async () => {
    const reconstruction=await reconstructCompany('rc_product',new Date('2026-01-01'));
    expect(reconstruction.identity).toMatchObject({productId:'rc_product',name:'Unfamiliar Co',evidenceRef:{kind:'product',id:'rc_product'}});
    expect(Object.fromEntries(reconstruction.systems.map((system) => [system.name,system.epistemicStatus])))
      .toEqual({stripe:'known',github:'stale'});
    expect(reconstruction.responsibilities).toEqual([expect.objectContaining({
      title:'Restore support capacity',owner:'unknown',activeAuthority:false,
    })]);
    expect(reconstruction.unknowns).toContain('company_purpose');
    expect(JSON.stringify(reconstruction)).not.toContain('Foreign');
    expect((await reconstructCompany('missing')).identity).toBeNull();
  });
});
