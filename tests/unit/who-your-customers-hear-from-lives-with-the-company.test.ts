// =============================================================================
// WHO YOUR CUSTOMERS HEAR FROM LIVES WITH THE COMPANY.
//
// The second section on Settings that was never a setting. A sending identity
// is not a preference; it is a per-company credential deciding whose name
// arrives in a stranger's inbox. It sat on the one page that holds none of a
// company's other facts, while the company page — where an owner goes to ask
// what is true of a business — said nothing about it at all.
//
// AND IT DELIBERATELY DID NOT FOLLOW THE APPLICATION KEY TO CONNECTORS.
// That is where the symmetry pointed and it would have been wrong. Connectors
// is the reading surface and says so in as many words: "Publishing a listing,
// changing a price, messaging a customer and moving money each need their own
// permission, and none of them comes from this." A sending identity IS the
// permission to message a customer. Filing it there would have made that
// sentence false on the page that says it.
//
// So this pins the distinction as behaviour, not as a comment: the credential
// is reachable where it belongs, and the reading surface still says the thing
// that would have become a lie.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { sendingIdentityPlacement } from '../../src/views/owner/sending-identity.js';

const F = 'f_send', P = 'p_send';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [F, 'c_send', 'owner@example.com', 'Thomas']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  const { settingsRoutes } = await import('../../src/routes/dashboard/settings.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'owner@example.com' }); await next();
  });
  app.route('/', foundryShellRoutes);
  app.route('/', settingsRoutes);
});

const get = async (path: string): Promise<string> => {
  const res = await app.request(path);
  expect(res.status, `${path} did not render`).toBe(200);
  return res.text();
};

describe('the company page can answer who its customers hear from', () => {
  it('carries the form, where the company is', async () => {
    const html = await get(`/foundry/companies/${P}`);
    expect(html).toContain('Who your customers hear from');
    expect(html).toContain('name="from_email"');
    expect(html).toContain('name="credential"');
  });

  it('returns him to the company, not to Settings', async () => {
    const html = await get(`/foundry/companies/${P}`);
    expect(html).toContain(`name="back" value="/foundry/companies/${P}"`);
  });

  it('says plainly that nothing is connected, rather than looking ready', async () => {
    const html = await get(`/foundry/companies/${P}`);
    expect(html).toContain('mail to your customers is refused until it is');
  });
});

describe('it did not become a connector, and the reading surface stays true', () => {
  it('leaves no sending credential on the Connectors detail page', async () => {
    // The specific confusion being prevented: a box for an outbound credential
    // on a surface whose whole claim is that it only reads.
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).not.toContain('name="from_email"');
    expect(html).not.toContain('name="credential"');
  });

  it('still says messaging a customer needs its own permission', async () => {
    // The sentence that filing a sending identity there would have falsified.
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html.replace(/\s+/g, ' ')).toContain('messaging a customer');
  });
});

describe('Settings gave it up and said where it went', () => {
  it('no longer carries the form', async () => {
    const html = await get('/settings');
    expect(html).not.toContain('name="from_email"');
  });

  it('still names the responsibility, so it does not read as deleted', async () => {
    const html = await get('/settings');
    expect(html).toContain('Who your customers hear from');
    expect(html).toContain(`/foundry/companies/${P}`);
  });
});

describe('the placement says what is true and escapes what it was given', () => {
  it('distinguishes connected from proved to work', async () => {
    const unproved = sendingIdentityPlacement({
      identity: { fromEmail: 'a@b.test', fromName: null, provider: 'resend', lastAcceptedAt: null },
      action: '/x', disconnectAction: '/y',
    });
    expect(unproved).toContain('has not been proved to work');
    const proved = sendingIdentityPlacement({
      identity: {
        fromEmail: 'a@b.test', fromName: null, provider: 'resend',
        lastAcceptedAt: '2026-09-01',
      },
      action: '/x', disconnectAction: '/y',
    });
    expect(proved).toContain('Last accepted by the provider 2026-09-01');
    expect(proved).not.toContain('has not been proved to work');
  });

  it('never puts a display name into markup unescaped', async () => {
    const out = sendingIdentityPlacement({
      identity: {
        fromEmail: 'a@b.test', fromName: '"><script>alert(1)</script>',
        provider: 'resend', lastAcceptedAt: null,
      },
      action: '/x', disconnectAction: '/y',
    });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('offers a disconnect only when there is something to disconnect', () => {
    expect(sendingIdentityPlacement({ identity: null, action: '/x', disconnectAction: '/y' }))
      .not.toContain('Disconnect');
    expect(sendingIdentityPlacement({
      identity: { fromEmail: 'a@b.test', fromName: null, provider: 'resend', lastAcceptedAt: null },
      action: '/x', disconnectAction: '/y',
    })).toContain('Disconnect');
  });

  it('says disconnecting stops the mail rather than resending it as Foundry', () => {
    const out = sendingIdentityPlacement({
      identity: { fromEmail: 'a@b.test', fromName: null, provider: 'resend', lastAcceptedAt: null },
      action: '/x', disconnectAction: '/y',
    });
    expect(out).toContain('It does not send it as Foundry instead');
  });
});
