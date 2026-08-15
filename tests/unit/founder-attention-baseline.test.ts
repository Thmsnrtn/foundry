process.env.TURSO_DATABASE_URL = 'file::memory:';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { getFounderAttentionBaseline } from '../../src/services/institution/attention-baseline.js';
import { setResponsibilityDisposition } from '../../src/services/institution/responsibility.js';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id,clerk_user_id,email) VALUES ('ab_owner','ab_clerk','ab@example.com'),('ab_other','ab_other_clerk','other@example.com')", []);
  await query("INSERT INTO products (id,name,owner_id) VALUES ('ab_product','Baseline Co','ab_owner'),('ab_foreign','Other Co','ab_other')", []);
  await query(`INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary) VALUES
    ('ab_signal','ab_product','manual','support_spike','medium','{}','Support is overloaded'),
    ('ab_foreign_signal','ab_foreign','manual','support_spike','medium','{}','Foreign evidence')`, []);
  await query(`INSERT INTO institutional_responsibilities (id,product_id,title,capability,state,evidence_ref) VALUES
    ('ab_visible','ab_product','Understand support load','customer_support','visible','signal_event:ab_signal'),
    ('ab_shadow','ab_product','Shadow support triage','customer_support','shadowing','signal_event:ab_signal'),
    ('ab_operating','ab_product','Operate support triage','customer_support','operating','signal_event:ab_signal'),
    ('ab_exception','ab_product','Own support exceptions','customer_support','exception_owned','signal_event:ab_signal'),
    ('ab_foreign_r','ab_foreign','Other tenant work','customer_support','visible','signal_event:ab_foreign_signal')`, []);
  await setResponsibilityDisposition({
    productId: 'ab_product', responsibilityId: 'ab_visible', ownerId: 'ab_owner',
    disposition: 'deliberately_not_done', reason: 'Wait for staffing plan', evidenceRef: 'signal_event:ab_signal',
  });
  await setResponsibilityDisposition({
    productId: 'ab_product', responsibilityId: 'ab_visible', ownerId: 'ab_owner',
    disposition: 'active', reason: 'Staffing plan arrived', evidenceRef: 'signal_event:ab_signal',
  });
});

describe('founder-attention baseline', () => {
  it('derives bounded counts from canonical current state and owner history', async () => {
    expect(await getFounderAttentionBaseline('ab_product', new Date(0))).toEqual({
      totalResponsibilities: 4,
      unresolvedResponsibilities: 3,
      requiringOwnerAuthority: 1,
      reconstructionRequired: 1,
      explicitOwnerInterventions: 2,
      reopenedDeliberateNonActions: 1,
      exceptionOwnedResponsibilities: 1,
    });
  });

  it('preserves product scope and time bounds instead of attributing foreign or old decisions', async () => {
    const future = new Date(Date.now() + 86_400_000);
    expect((await getFounderAttentionBaseline('ab_product', future)).explicitOwnerInterventions).toBe(0);
    expect(await getFounderAttentionBaseline('ab_foreign', new Date(0))).toMatchObject({
      totalResponsibilities: 1, unresolvedResponsibilities: 1, reconstructionRequired: 1,
      explicitOwnerInterventions: 0,
    });
    expect(await getFounderAttentionBaseline('missing', new Date(0))).toEqual({
      totalResponsibilities: 0, unresolvedResponsibilities: 0, requiringOwnerAuthority: 0,
      reconstructionRequired: 0, explicitOwnerInterventions: 0,
      reopenedDeliberateNonActions: 0, exceptionOwnedResponsibilities: 0,
    });
  });
});
