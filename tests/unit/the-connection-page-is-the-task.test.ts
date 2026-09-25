// =============================================================================
// THE CONNECTION PAGE IS THE TASK, NOT AN ESSAY ABOUT IT.
//
// The owner placed his Etsy keystring and shared secret, pressed save, and
// said the page "doesn't say Etsy is connected" and "still seems like the
// older text heavy ui". Two things were true of the page he landed on:
//
//   · the save WAS acknowledged — inside a fold the save itself had just
//     closed, because a placed key moves the key block behind a disclosure;
//   · the next step, connecting the shop, was a sentence and a link to a
//     different page whose own button began the authorisation.
//
// These tests hold the rebuilt page to the task: the acknowledgement is in
// view, where it has got to is three marks, and the thing to press is on it.
// =============================================================================


process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';

const F = 'f_task', P = 'p_task';
const HERE = '/foundry/controls/connectors/etsy';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_task', 'owner@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'owner@example.com' }); await next();
  });
  app.route('/', foundryShellRoutes);
});

const get = async (qs = ''): Promise<string> => {
  const res = await app.request(`https://foundry.test${HERE}${qs}`);
  expect(res.status).toBe(200);
  return res.text();
};

/** What is on the page before the first fold opens — what he sees without tapping. */
const inView = (html: string): string => html.slice(0, html.indexOf('<details'));

describe('with no key, the page is the form', () => {
  it('marks step one of three as the step he is on', async () => {
    const html = await get();
    expect(html).toContain('class="trail"');
    expect(html).toMatch(/<li class="now" aria-current="step">\s*<b>[\s\S]*?App key/);
  });

  it('puts both boxes and the address to copy in view, not behind a fold', async () => {
    const top = inView(await get());
    expect(top).toContain('name="keystring"');
    expect(top).toContain('name="shared_secret"');
    expect(top).toContain('data-copy="etsy-callback"');
    expect(top).toContain('value="https://foundry.test/foundry/senses/callback"');
  });

  it('says a refusal where he is looking', async () => {
    const top = inView(await get('?etsy_error=Etsy%20refused%20that%20pair'));
    expect(top).toContain('Not saved.');
    expect(top).toContain('Etsy refused that pair');
  });
});

describe('with the key saved, the page says so and offers the next thing', () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref,
         verified_at, set_at, set_by)
       VALUES ('etsy', ?, '5544332', datetime('now'), datetime('now'), 'test')`,
      [encryptCredentialPayload(JSON.stringify({ keystring: 'k'.repeat(24), sharedSecret: 's3cr3t' }))]);
  });

  it('acknowledges the save in view, not inside the fold the save closed', async () => {
    // THE DEFECT, EXACTLY. The flash was rendered, and rendered inside a
    // <details> that is closed once a key is placed.
    const top = inView(await get('?etsy=placed&app=5544332'));
    expect(top).toContain('Saved.');
    expect(top).toContain('5544332');
  });

  it('ticks step one and moves him to step two', async () => {
    const html = await get();
    expect(html).toMatch(/<li class="done">\s*<b>[\s\S]*?App key/);
    expect(html).toMatch(/<li class="now" aria-current="step">\s*<b>[\s\S]*?Connect shop/);
  });

  it('carries the connect button itself, posting what the revenue page posts', async () => {
    const top = inView(await get());
    expect(top).toContain(`action="/foundry/companies/${P}/see/revenue"`);
    expect(top).toContain('name="provider" value="etsy"');
    expect(top).toContain('name="mode" value="real"');
    expect(top).toContain('Connect Etsy shop');
  });

  it('asks for no more than the constitutional scopes, and says what it cannot do', async () => {
    // The form carries a choice between offers and nothing else. What is
    // requested, and the disclosure stored with the grant, stay server-derived.
    const top = inView(await get()).replace(/\s+/g, ' ');
    expect(top).not.toMatch(/name="scope/);
    expect(top).toContain('It cannot');
  });

  it('still never puts either half of the pair on the page', async () => {
    const html = await get('?etsy=placed&app=5544332');
    expect(html).not.toContain('k'.repeat(24));
    expect(html).not.toContain('s3cr3t');
  });
});
