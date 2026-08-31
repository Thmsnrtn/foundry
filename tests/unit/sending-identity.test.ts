// =============================================================================
// Tests: a company's own sender, so the rule can finally be obeyed
//
// `sender-of-record.ts` has always said Foundry must never be the From on a
// message to a founder's CUSTOMER. The guard had zero callers — and could not
// have had any, because the thing it presupposes did not exist. Every send in
// the system went through Foundry's platform key, so no caller COULD send as
// the founder. The rule was unsatisfiable, which is why it was unenforced.
//
// Migration 150 and `outbound/sending-identity.ts` are the missing half: one
// sending identity per company, holding the founder's own provider credential
// and the From their customers see.
//
// WHY A CREDENTIAL AND NOT AN ADDRESS. Foundry cannot verify that a founder
// owns a domain, and a `verified_at` we set ourselves would be a claim with no
// evidence. Sending through the founder's own provider account makes the
// verification real and performed by somebody who can do it — the provider
// refuses a domain the account has not verified — and puts the reputation,
// the bounces and the compliance obligation on the party that owns the domain.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  clearSendingIdentity, getSendingIdentity, getSendingIdentitySummary,
  SendingIdentityError, setSendingIdentity,
} from '../../src/services/outbound/sending-identity.js';
import { SenderOfRecordError } from '../../src/services/outbound/sender-of-record.js';

const F = 'si_f';
const P = 'si_p';
const FOUNDER_EMAIL = 'ada@company.example';
const CUSTOMER = 'buyer@elsewhere.example';

function send(to: string) {
  return {
    productId: P, agent: 'system', tool: 'send_email', action: 'notice',
    params: { to: [to], subject: 'Hi', html: '<p>hi</p>' },
    dedupKey: `k:${to}:${Math.random()}`, customerExternalId: to,
  };
}

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)`,
    [F, 'clerk_si', FOUNDER_EMAIL]);
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?,'Sending Co',?)`, [P, F]);
});

beforeEach(async () => {
  await clearSendingIdentity(P);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv('RESEND_API_KEY', 'foundry_platform_key');
});

describe('connecting a sender', () => {
  it('stores it and reads it back without the credential leaking to the page', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'Hello@Company.Example', fromName: 'Ada at Company',
    });

    const full = await getSendingIdentity(P);
    expect(full?.credential, 'the send boundary needs it').toBe('re_founder_key');
    expect(full?.fromEmail, 'normalised, so the same address is one address')
      .toBe('hello@company.example');

    const summary = await getSendingIdentitySummary(P) as unknown as Record<string, unknown>;
    expect(summary.fromEmail).toBe('hello@company.example');
    expect(summary, 'nothing that renders a settings page decrypts an API key')
      .not.toHaveProperty('credential');
  });

  it('is stored encrypted at rest', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example',
    });
    const row = (await query(
      'SELECT credential FROM product_sending_identities WHERE product_id = ?', [P]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.credential)).not.toContain('re_founder_key');
  });

  it('refuses a Foundry address, at the point of setup', async () => {
    // A founder who pastes a Foundry address here has misunderstood what this
    // is for, and being told now beats every send failing later.
    await expect(setSendingIdentity({
      productId: P, provider: 'resend', credential: 'k',
      fromEmail: 'hello@foundry.app',
    })).rejects.toThrow(SendingIdentityError);
  });

  it('refuses something that is not an address, and an empty key', async () => {
    await expect(setSendingIdentity({
      productId: P, provider: 'resend', credential: 'k', fromEmail: 'not-an-address',
    })).rejects.toThrow(SendingIdentityError);
    await expect(setSendingIdentity({
      productId: P, provider: 'resend', credential: '  ', fromEmail: 'a@b.example',
    })).rejects.toThrow(SendingIdentityError);
  });

  it('forgets that the previous key worked when the key is replaced', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 'k1', fromEmail: 'a@company.example',
    });
    await query(
      `UPDATE product_sending_identities SET last_accepted_at = datetime('now') WHERE product_id = ?`,
      [P]);
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 'k2', fromEmail: 'a@company.example',
    });
    expect((await getSendingIdentitySummary(P))?.lastAcceptedAt,
      'the old key’s successes say nothing about this one').toBeNull();
  });
});

describe('mail to a customer', () => {
  it('refuses when the company has no sender of its own', async () => {
    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await expect(sendEmailHandler(send(CUSTOMER) as never))
      .rejects.toThrow(SenderOfRecordError);
  });

  it('says what the founder has to do about it', async () => {
    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await expect(sendEmailHandler(send(CUSTOMER) as never))
      .rejects.toThrow(/Settings/);
  });

  it('goes out as the founder, through the founder’s own account', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example', fromName: 'Ada',
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await sendEmailHandler(send(CUSTOMER) as never);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from,
      'their domain, their name on the message').toBe('Ada <hello@company.example>');
    expect((init.headers as Record<string, string>).Authorization,
      'and their provider account, which is what makes the domain verified')
      .toBe('Bearer re_founder_key');
  });

  it('records that the provider accepted it, only after it did', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example',
    });
    expect((await getSendingIdentitySummary(P))?.lastAcceptedAt,
      'connected is not the same fact as working').toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 })));
    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await sendEmailHandler(send(CUSTOMER) as never);

    expect((await getSendingIdentitySummary(P))?.lastAcceptedAt).not.toBeNull();
  });

  it('refuses again once the sender is disconnected', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 'k', fromEmail: 'a@company.example',
    });
    expect(await clearSendingIdentity(P)).toBe(true);

    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await expect(sendEmailHandler(send(CUSTOMER) as never))
      .rejects.toThrow(SenderOfRecordError);
  });

  it('does not reach Foundry’s SendGrid account', async () => {
    // What this actually proves is that a company send goes to the company's
    // own provider — the SendGrid branch is structurally out of reach because
    // a connected identity always carries a credential. The condition
    // excluding it is kept in the code as the statement of the rule, and this
    // test does not pretend to exercise it.
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example',
    });
    vi.stubEnv('SENDGRID_API_KEY', 'sg_foundry');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await sendEmailHandler(send(CUSTOMER) as never);
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('sendgrid');
  });
});

describe('mail to the founder', () => {
  it('still comes from Foundry, through Foundry, with no identity connected', async () => {
    // Foundry writing to its own customer is exactly what the rule permits,
    // and this is most of the traffic — welcome, digests, alerts, billing.
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await sendEmailHandler(send(FOUNDER_EMAIL) as never);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from).toMatch(/foundry\.app/);
    expect((init.headers as Record<string, string>).Authorization)
      .toBe('Bearer foundry_platform_key');
  });

  it('is unaffected by the company having connected a sender', async () => {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example',
    });
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const { sendEmailHandler } = await import('../../src/services/integration/resend.js');
    await sendEmailHandler(send(FOUNDER_EMAIL) as never);

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from,
      'a briefing is Foundry writing to its customer, not the company writing to theirs')
      .toMatch(/foundry\.app/);
  });
});

describe('the founder can reach the control', () => {
  // A rule the person it binds cannot satisfy is not a rule, it is an outage.
  const routes = readFileSync(
    resolve(__dirname, '../../src/routes/dashboard/settings.ts'), 'utf8');

  it('has a route to connect one and a route to disconnect', () => {
    expect(routes).toMatch(/post\('\/settings\/sending-identity'/);
    expect(routes).toMatch(/post\('\/settings\/sending-identity\/disconnect'/);
  });

  it('renders the form on the settings page', () => {
    expect(routes).toMatch(/action="\/settings\/sending-identity"/);
  });

  it('shows the founder why a rejected address was rejected', () => {
    // The Mark Reviewed button spent its whole life silently doing nothing.
    expect(routes).toMatch(/sending_error/);
  });
});

// =============================================================================
// A refusal is not an ambiguity.
//
// The gateway mapped every handler throw to phase 'execution', which callers
// read as "the handler ran and we do not know what reached the outside world"
// — `responsibility-assisted-email.ts` sets effect_certainty='ambiguous' on it
// and books a reconciliation window. That is right for a socket that closed
// mid-write. It is wrong for a message the handler refused to send before
// touching the provider: nothing was attempted, and filing it as ambiguous
// invents reconciliation work for an effect that does not exist and reports
// the send as dispatched.
// =============================================================================

describe('a refusal before dispatch is definitive', () => {
  it('is reported as refused, not as an execution failure', async () => {
    const { invoke } = await import('../../src/services/outbound/gateway.js');
    const { sendEmailHandler, SEND_EMAIL_POLICY } = await import(
      '../../src/services/integration/resend.js');
    const { registerToolHandler } = await import('../../src/services/outbound/gateway.js');
    registerToolHandler('send_email', sendEmailHandler, SEND_EMAIL_POLICY);

    const result = await invoke({
      productId: P, tool: 'send_email', action: 'assisted notice',
      params: { to: [CUSTOMER], subject: 'Hi', html: '<p>hi</p>' },
      dedupKey: `refuse:${Math.random()}`, customerExternalId: CUSTOMER,
      surface: 'email_outbound', dataClass: 'customer',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.phase,
      'ambiguous would book reconciliation for a message that never left')
      .toBe('refused');
    expect(result.reason).toMatch(/sending address/i);
  });

  it('and the assisted path treats only execution as ambiguous', () => {
    // This is the one live third-party sender, and the reachable consequence
    // of enforcing the rule. It must not claim the notice was dispatched.
    // Read from the source: driving the full ladder here would prove less
    // about this line than the line itself does.
    const assisted = readFileSync(
      resolve(__dirname, '../../src/services/institution/responsibility-assisted-email.ts'),
      'utf8');
    const decision = assisted.match(/const ambiguous\s*=\s*[^\n;]+/)?.[0] ?? '';
    expect(decision, 'the ambiguity test must exist to be checked').not.toBe('');
    expect(decision).toContain("'execution'");
    expect(decision,
      'a refusal before dispatch must not book a reconciliation window')
      .not.toContain('refused');
  });
});

// =============================================================================
// A SENDER IS NOT AN AUTHORITY.
//
// Connecting a sending address establishes WHO a message comes from. It
// establishes nothing about whether the message may be sent: not the
// institution's permission to act for this company, not the recipient's
// consent, not the budget, not the classification. A credential that quietly
// became an authority shortcut would be the same defect as an API key
// satisfying a human role check, one layer down.
//
// The sender is resolved INSIDE the gateway's handler, so the ordinary chain
// runs first and these prove it still does.
// =============================================================================

describe('a configured sender does not authorise the send', () => {
  async function connect(): Promise<void> {
    await setSendingIdentity({
      productId: P, provider: 'resend', credential: 're_founder_key',
      fromEmail: 'hello@company.example', fromName: 'Ada',
    });
  }

  function invoked(to: string) {
    return {
      productId: P, tool: 'send_email', action: 'customer notice',
      params: { to: [to], subject: 'Hi', html: '<p>hi</p>' },
      dedupKey: `auth:${to}:${Math.random()}`, customerExternalId: to,
      surface: 'email_outbound', dataClass: 'customer',
    };
  }

  it('is still refused when the founder has paused the company', async () => {
    await connect();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await query(`UPDATE products SET scp_status='paused' WHERE id=?`, [P]);
    try {
      const { invoke, registerToolHandler } = await import('../../src/services/outbound/gateway.js');
      const { sendEmailHandler, SEND_EMAIL_POLICY } = await import(
        '../../src/services/integration/resend.js');
      registerToolHandler('send_email', sendEmailHandler, SEND_EMAIL_POLICY);

      const result = await invoke(invoked(CUSTOMER) as never);
      expect(result.ok, 'having a sender is not having permission to use it').toBe(false);
      if (!result.ok) expect(result.phase).toBe('kill_switch');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await query(`UPDATE products SET scp_status='active' WHERE id=?`, [P]);
    }
  });

  it('is still refused when the subscription has lapsed', async () => {
    await connect();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    await query(`UPDATE products SET entitlement_paused_at=datetime('now') WHERE id=?`, [P]);
    try {
      const { invoke } = await import('../../src/services/outbound/gateway.js');
      const result = await invoke(invoked(CUSTOMER) as never);
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      await query(`UPDATE products SET entitlement_paused_at=NULL WHERE id=?`, [P]);
    }
  });

  it('goes out when the company may act AND has a sender', async () => {
    // Both are required, and neither substitutes for the other.
    await connect();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: 'm' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { invoke } = await import('../../src/services/outbound/gateway.js');
    const result = await invoke(invoked(CUSTOMER) as never);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
