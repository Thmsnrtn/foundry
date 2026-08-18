process.env.TURSO_DATABASE_URL='file::memory:';
import { beforeAll,describe,expect,it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { activeResponsibilityAuthority,recordConsent,revokeConsent } from '../../src/services/autopilot/consent.js';

beforeAll(async()=>{
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('authority_owner','authority_clerk','owner@example.com'),('authority_foreign','authority_foreign_clerk','foreign@example.com')",[]);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('authority_product','Authority Co','authority_owner'),('authority_foreign_product','Foreign','authority_foreign')",[]);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state) VALUES
    ('authority_resp','authority_product','Send bounded support update','customer_support','shadowing'),
    ('authority_other','authority_product','Other support work','customer_support','shadowing'),
    ('authority_not_shadowing','authority_product','Not yet watched','customer_support','understood'),
    ('authority_foreign_resp','authority_foreign_product','Foreign support work','customer_support','shadowing')`,[]);
});

describe('responsibility-bound authority',()=>{
  it('binds product, responsibility, capability, scope, consequence, expiry, and owner',async()=>{
    const id=await recordConsent({founderId:'authority_owner',productId:'authority_product',capability:'customer_support',
      fromMode:'suggest',toMode:'act',responsibilityId:'authority_resp',allowedScope:['send_status_update'],
      consequenceBoundary:'low',expiresAt:new Date('2099-01-01')});
    expect(await activeResponsibilityAuthority('authority_product','authority_resp','customer_support','send_status_update')).toEqual({id});
    expect(await activeResponsibilityAuthority('authority_product','authority_other','customer_support','send_status_update')).toBeNull();
    expect(await activeResponsibilityAuthority('authority_product','authority_resp','billing_recovery','send_status_update')).toBeNull();
    expect(await activeResponsibilityAuthority('authority_product','authority_resp','customer_support','refund')).toBeNull();
  });

  it('refuses forged, cross-tenant, expired, empty-scope, and non-Shadowing grants',async()=>{
    const base={founderId:'authority_owner',productId:'authority_product',capability:'customer_support',fromMode:'suggest',toMode:'act',
      responsibilityId:'authority_resp',allowedScope:['send_status_update'],consequenceBoundary:'low' as const,expiresAt:new Date('2099-01-01')};
    await expect(recordConsent({...base,founderId:'authority_foreign'})).rejects.toThrow();
    await expect(recordConsent({...base,responsibilityId:'authority_foreign_resp'})).rejects.toThrow();
    await expect(recordConsent({...base,expiresAt:new Date('2020-01-01')})).rejects.toThrow();
    await expect(recordConsent({...base,allowedScope:[]})).rejects.toThrow();
    // A responsibility that is not Shadowing cannot be granted authority. This
    // used to be arranged by writing `state='assisting'` onto a shadowing row;
    // migration 159 closed that door, and the fixture no longer needs it — a
    // row born 'understood' has never been watched, which is the actual reason
    // the grant is refused.
    await expect(recordConsent({...base,responsibilityId:'authority_not_shadowing'})).rejects.toThrow();
  });

  it('fails closed after revocation and legacy capability consent cannot authorize a responsibility',async()=>{
    await recordConsent({founderId:'authority_owner',productId:'authority_product',capability:'customer_support',fromMode:'suggest',toMode:'act'});
    expect(await activeResponsibilityAuthority('authority_product','authority_other','customer_support','send_status_update')).toBeNull();
    await revokeConsent('authority_product','customer_support');
    expect(await activeResponsibilityAuthority('authority_product','authority_resp','customer_support','send_status_update')).toBeNull();
  });
});
