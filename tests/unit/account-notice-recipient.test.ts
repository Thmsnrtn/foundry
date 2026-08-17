// =============================================================================
// Tests: who an account notice is allowed to reach
//
// `send_account_notice` is the single capability that survives a company pause.
// It took its recipient from the request. That made it a way to mail ANY
// address from an account that is supposed to be silent — five templates' worth
// of content, but any recipient, on a company nothing else can send from.
//
// The only person an account notice is for is the account's owner, and the
// server knows who that is. §4: authentication established which company; it
// must not also let the payload choose who hears about it.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';

// Capture what the transport is asked to send. The boundary under test is the
// recipient, not Resend.
const sent: Array<{ to: unknown; subject: unknown }> = [];
vi.mock('../../src/services/integration/resend.js', () => ({
  sendEmailHandler: async (req: { params: Record<string, unknown> }) => {
    sent.push({ to: req.params.to, subject: req.params.subject });
    return { message_id: 'em_stub' };
  },
  SEND_EMAIL_POLICY: {
    actor: 'email_delivery', surface: 'email_outbound', dataClass: 'customer',
    requireDedupKey: true, requireCustomerExternalId: true,
  },
}));

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sendAccountNotice } from '../../src/services/billing/account-notice.js';

beforeAll(async () => {
  await runMigrations();
  await query(
    `INSERT INTO founders (id, clerk_user_id, email) VALUES ('an_f','an_c','owner@example.com')`);
  await query(
    `INSERT INTO products (id, name, owner_id, status, scp_status)
     VALUES ('an_p','Notice Co','an_f','active','paused')`);
});

describe('an account notice goes to the account owner', () => {
  it('ignores the address the caller passed', async () => {
    const ok = await sendAccountNotice({
      productId: 'an_p',
      to: 'attacker@example.com',
      notice: { kind: 'trial_ended', companyName: 'Notice Co' },
    });
    expect(ok).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0].to).toEqual(['owner@example.com']);
    expect(JSON.stringify(sent[0])).not.toContain('attacker@example.com');
  });

  it('refuses when there is no owner to reach', async () => {
    await query(
      `INSERT INTO founders (id, clerk_user_id, email) VALUES ('an_f2','an_c2','')`);
    await query(
      `INSERT INTO products (id, name, owner_id, status, scp_status)
       VALUES ('an_p2','Orphan','an_f2','active','paused')`);
    const ok = await sendAccountNotice({
      productId: 'an_p2', to: 'someone@example.com',
      notice: { kind: 'trial_ended', companyName: 'Orphan' },
    });
    expect(ok, 'no owner means no notice, not a notice to whoever asked').toBe(false);
    expect(sent.length).toBe(1);
  });
});
