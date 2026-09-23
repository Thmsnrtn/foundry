// =============================================================================
// THE KEY IS PLACED WHERE THE CONNECTION LIVES.
//
// The owner, on what to hold the work to: "Make complete owner journeys a
// first-class acceptance standard alongside visual quality, theme consistency,
// and mobile fit. A route rendering or a control meeting its touch-target
// requirement does not establish the task can be accomplished."
//
// So this does not ask whether the Etsy connector page renders. It asks
// whether an owner who arrives there intending to connect Etsy can finish the
// one step that is his without being sent somewhere else to do it — and
// whether the page that used to hold that form still tells him where it went.
//
// The journey under test, in his order:
//   Controls -> Connectors -> Etsy
//   learn the redirect URI, which only this deployment can tell him
//   paste both halves and press one button
//   come back to this page, not to Settings
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { etsyKeyPlacement } from '../../src/views/owner/etsy-key.js';
import { forgetAppCredential, placedApplicationRef } from '../../src/services/senses/app-credential.js';
import { encrypt } from '../../src/services/encryption.js';

const F = 'f_key', P = 'p_key';
const HERE = '/foundry/controls/connectors/etsy';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_key', 'owner@example.com']);
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

describe('the owner can place the key without leaving the connection', () => {
  it('offers both halves of the pair on the Etsy connector itself', async () => {
    const html = await get(HERE);
    expect(html).toContain('action="/settings/app-credential/etsy"');
    expect(html).toContain('name="keystring"');
    expect(html).toContain('name="shared_secret"');
  });

  it('tells him the redirect URI, which nothing else could', async () => {
    // Etsy refuses an authorization whose redirect_uri is not registered, and
    // Foundry derives this from the request host rather than from a setting —
    // so it is unguessable and this is the only place it is knowable.
    const html = await get(HERE);
    expect(html).toContain('/foundry/senses/callback');
  });

  it('returns him to the connection, not to Settings', async () => {
    const html = await get(HERE);
    expect(html).toContain(`name="back" value="${HERE}"`);
  });

  it('does not offer a button to the page he is already on', async () => {
    // The journey's `next` at `no_key` now points at this page, which is right
    // from the Connectors list and, here, is a control that reloads. The
    // sentence stays; the button would be a lie about there being somewhere
    // to go.
    const html = await get(HERE);
    const doThat = html.split('Do that').length - 1;
    expect(doThat, 'a "Do that" button points back at this very page').toBe(0);
  });

  it('keeps the shared secret hidden and the keystring readable', async () => {
    // The keystring is an identifier, not a secret: it travels in the open as
    // the client_id on the consent URL. Masking it protects nothing and costs
    // the ability to see that a 24-character paste arrived whole.
    const html = await get(HERE);
    expect(html).toMatch(/type="text" name="keystring"/);
    expect(html).toMatch(/type="password" name="shared_secret"/);
  });
});

describe('Settings gave the section up and said so', () => {
  it('no longer carries the form', async () => {
    const html = await get('/settings');
    expect(html).not.toContain('name="shared_secret"');
  });

  it('still tells him where it went, so it does not read as deleted', async () => {
    const html = await get('/settings');
    expect(html).toContain('Etsy application key');
    expect(html).toContain(HERE);
  });
});

describe('the placement block is one block', () => {
  it('escapes what the provider said rather than trusting it as markup', () => {
    const out = etsyKeyPlacement({
      placedAs: null, back: '/x', error: '<img src=x onerror=alert(1)>',
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('escapes a back path rather than letting it close the attribute', () => {
    const out = etsyKeyPlacement({ placedAs: null, back: '/x" onfocus="evil()' });
    expect(out).toContain('&quot;');
    expect(out).not.toContain('onfocus="evil()"');
  });

  it('offers "Forget it" only once something is placed', () => {
    expect(etsyKeyPlacement({ placedAs: null, back: '/x' }))
      .not.toContain('app-credential/etsy/forget');
    expect(etsyKeyPlacement({ placedAs: '123', back: '/x' }))
      .toContain('app-credential/etsy/forget');
  });

  it('names the application without being handed the secret', () => {
    const out = etsyKeyPlacement({ placedAs: '99887766', back: '/x' });
    expect(out).toContain('99887766');
    expect(out).toContain('Replace the key');
  });
});

describe('asking which application is placed does not open the envelope', () => {
  it('answers null when there is none, like the decrypting reader does', async () => {
    expect(await placedApplicationRef('etsy')).toBeNull();
  });

  it('answers the provider ref from the row, with no key material in reach', async () => {
    // Written directly rather than through `setAppCredential`, because that
    // path calls Etsy — and the point of this reader is that it never needs to.
    //
    // Really encrypted, because the table refuses anything else: migration
    // 342's `app_credential:must_be_encrypted` rejected a plaintext fixture
    // outright. A row that could only exist in a test is not a fixture for
    // behaviour that must hold in production, and the schema said so before
    // this test could pretend otherwise.
    await query(
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref, verified_at, set_by)
       VALUES ('etsy', ?, '55443322', ?, ?)`,
      [encrypt(JSON.stringify({ keystring: 'k', sharedSecret: 's' })),
        new Date().toISOString(), `founder:${F}`]);
    expect(await placedApplicationRef('etsy')).toBe('55443322');
  });

  it('stops answering once the key is forgotten', async () => {
    // Through the real forgetting, not an UPDATE: migration 345 refuses a
    // row that goes quiet without saying why, so the only way to forget a key
    // is the way production forgets one.
    await forgetAppCredential('etsy', 'the test finished with it');
    expect(await placedApplicationRef('etsy')).toBeNull();
  });
});
