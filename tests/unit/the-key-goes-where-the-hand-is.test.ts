// =============================================================================
// THE KEY GOES WHERE THE HAND IS.
//
// The owner, 22 September 2026, having done his part at Etsy: "the setting page
// it's kinda too complicated in foundry. Have no idea how to do that."
//
// That is not a complaint about wording. It is a defect report against a
// promise this codebase already made. `senseProvider`'s own comment says null
// is returned so that a surface can name what is missing "rather than offering
// a button that would fail" — and the Etsy adapter registers whether or not an
// application key has been placed. So the button appeared, the tap threw, and
// the only way to satisfy the prerequisite was to leave the sentence that
// needed it, find one card among twenty on a settings page, and come back.
//
// Three things are proved here. That a provider can say it needs a key before
// anything can be asked of it. That the surface reads that and offers the form
// in place of the button. And that the return trip cannot be aimed anywhere
// but back into this shell — because a redirect target arriving in a form field
// is a redirect target somebody else can choose.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
delete process.env.STRIPE_CONNECT_CLIENT_ID;

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatStandsBetween } from '../../src/services/senses/credentials.js';
import { safeBackPath } from '../../src/routes/dashboard/settings.js';
import { senseProvider } from '../../src/services/senses/providers/contract.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';
import { Hono } from 'hono';

const F = 'f_hand', P = 'p_hand';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_hand', 'owner@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'owner@example.com' }); await next();
  });
  app.route('/', foundryShellRoutes);
});

/**
 * RENDERED, NOT GREPPED. Everything above this line reads source strings, which
 * proves a branch was written and not that it is reachable — and "reachable"
 * is the entire complaint being answered.
 */
async function connectPage(): Promise<string> {
  const res = await app.request(`/foundry/companies/${P}/see/revenue`);
  expect(res.status, 'the connect page did not render for the owner').toBe(200);
  return res.text();
}

describe('a provider says whether it can be asked anything yet', () => {
  it('names the missing application key rather than looking ready', async () => {
    // The whole defect in one assertion: before this, the only question asked
    // was "is there an adapter", and the answer was yes.
    expect(await senseProvider('etsy')).not.toBeNull();
    expect(await whatStandsBetween('etsy')).toBe('no_app_key');
  });

  it('distinguishes that from a provider nothing can authorise at all', async () => {
    // Two obstacles, and only one of them is the owner's to clear. Collapsing
    // them into "cannot connect" would tell him to wait for something that was
    // waiting for him.
    expect(await whatStandsBetween('gumroad')).toBe('no_adapter');
  });

  it('stands aside once the key is there', async () => {
    await query(
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref,
         verified_at, set_at, set_by)
       VALUES ('etsy', ?, 'app_1', datetime('now'), datetime('now'), 'test')`,
      [encryptCredentialPayload(JSON.stringify({ keystring: 'k'.repeat(24), sharedSecret: 's'.repeat(10) }))],
    );
    expect(await whatStandsBetween('etsy')).toBeNull();
  });

  it('does not invent an obstacle for a provider that needs no key of its own', async () => {
    // The reference world authorises against nothing. If `needsAppCredential`
    // were assumed rather than declared, the controlled-proof path — the one
    // thing that travels the complete lifecycle — would have gone dark.
    expect(await whatStandsBetween('reference_world')).toBeNull();
  });
});

describe('the form is offered in the sentence that needs it', () => {
  const shell = readFileSync('src/routes/dashboard/foundry-shell.ts', 'utf8');

  it('branches on what stands between, not on whether an adapter exists', () => {
    expect(shell).toContain('whatStandsBetween');
    expect(shell).not.toContain('const canAsk = (await senseProvider(');
  });

  // THREE PROXIES REMOVED, NOT THREE PROPERTIES.
  //
  // These read `foundry-shell.ts` for the literal markup of the form and
  // broke the day the form became one module that three surfaces render.
  // Nothing they protected changed. What broke was the proxy — the same
  // failure this file annotates eighty lines below and did not generalise
  // from, so it is generalised here: a grep proves a string was typed
  // somewhere in a 7,000-line module; only a render proves the owner meets
  // it. Each of the three is now asserted against the rendered page, in
  // `the page he actually lands on`, which clears the key first so the form
  // is genuinely being offered rather than incidentally absent.

  it('shows a refusal where he typed, not on a page he has left', () => {
    expect(shell).toContain("c.req.query('etsy_error')");
  });
});

describe('the way back cannot be aimed somewhere else', () => {
  it('keeps a path into the shell', () => {
    expect(safeBackPath('/foundry/companies/p_1/see/revenue'))
      .toBe('/foundry/companies/p_1/see/revenue');
  });

  it('refuses a protocol-relative URL, which a leading-slash check would admit', () => {
    // The case that makes this worth a function. `//evil.test` starts with a
    // slash and is not a path.
    expect(safeBackPath('//evil.test')).toBe('/settings');
    expect(safeBackPath('//evil.test/foundry/')).toBe('/settings');
  });

  it('refuses an absolute URL and a scheme', () => {
    for (const bad of [
      'https://evil.test/foundry/',
      'http://evil.test',
      'javascript:alert(1)',
      '\\\\evil.test',
    ]) expect(safeBackPath(bad), bad).toBe('/settings');
  });

  it('refuses a query or fragment that would smuggle one', () => {
    expect(safeBackPath('/foundry/?next=https://evil.test')).toBe('/settings');
    expect(safeBackPath('/foundry/#@evil.test')).toBe('/settings');
  });

  it('refuses a path outside the shell, and empty', () => {
    expect(safeBackPath('/internal/health')).toBe('/settings');
    expect(safeBackPath('/foundryX/')).toBe('/settings');
    expect(safeBackPath('')).toBe('/settings');
  });
});

describe('only the half that authenticates is hidden', () => {
  const settings = readFileSync('src/routes/dashboard/settings.ts', 'utf8');

  // WHICH HALF IS MASKED is asserted against the rendered page below, for the
  // same reason: `settings.ts` no longer draws this form. Settings points at
  // the connection now, and where markup lives is an arrangement — that the
  // authenticating half is hidden and the identifier is not is the property.

  it('still never reaches for either half of the stored pair', () => {
    // THIS ASSERTION WAS A PROXY AND THE PROXY WENT STALE. It required the
    // card to render `etsyApp.providerAccountRef` — true when the card read
    // the credential row directly, and false once the journey reader took over
    // and the application id began arriving as a step's evidence. The security
    // property never changed; the string that stood in for it did.
    //
    // What is actually required is that this page never touches the secret.
    // That half is asserted here, and the real proof — that neither half
    // appears in a rendered response with a credential genuinely stored — is
    // in `he-can-tell-whether-it-saved`, which drives the page rather than
    // reading it.
    const flat = settings.replace(/\s+/g, ' ');
    expect(flat).not.toContain('etsyApp.secret');
    expect(flat).not.toContain('.sharedSecret');
    // The card still knows whether a key is there, which is what it is for.
    expect(flat).toContain('etsyApp ?');
  });
});

describe('the page he actually lands on', () => {
  it('asks for the pair instead of drawing a button that would throw', async () => {
    // The Etsy offer on this page, with no application key placed. Before this
    // change the page drew "Let me see what it earns" and `appKey()` threw on
    // the tap.
    await query("DELETE FROM app_credentials WHERE provider = 'etsy'");
    const html = await connectPage();
    expect(html).toContain('One thing first: which application is asking');
    expect(html).toContain('name="keystring"');
    expect(html).toContain('name="shared_secret"');
  });

  it('carries the way back to this same page', async () => {
    const html = await connectPage();
    expect(html).toContain(`name="back" value="/foundry/companies/${P}/see/revenue"`);
  });

  it('posts to the one place that verifies a pair before keeping it', async () => {
    expect(await connectPage()).toContain('action="/settings/app-credential/etsy"');
  });

  it('says the key grants no access to any shop, which is the fact he is owed', async () => {
    // The sentence he needs before typing a secret into a box: this names an
    // application, it does not open a shop, and opening one is a separate act
    // with its own consent screen.
    const flat = (await connectPage()).replace(/\s+/g, ' ');
    expect(flat).toContain('give access to any shop');
  });

  it('leaves the keystring readable and hides only the half that authenticates', async () => {
    // The keystring travels in the open as `client_id` on the consent URL he
    // is about to look at. Dots over it protect nothing and cost him the one
    // thing that matters when a 24-character string is pasted on a phone —
    // seeing that it arrived whole.
    const flat = (await connectPage()).replace(/\s+/g, ' ');
    expect(flat).toContain('<input type="text" name="keystring"');
    expect(flat).toContain('<input type="password" name="shared_secret"');
  });

  it('does not offer a form for a key that belongs in the environment', async () => {
    // Stripe is on this page too, and had the identical defect for the
    // identical reason. It is not his to supply, so he is told that rather
    // than handed a box for it.
    const html = await connectPage();
    expect(html).toContain('Nothing is missing on your side');
    expect(html).not.toContain('name="stripe_client_id"');
  });

  it('draws the button once the key is there, and stops asking', async () => {
    await query(
      `INSERT INTO app_credentials (provider, secret_json, provider_account_ref,
         verified_at, set_at, set_by)
       VALUES ('etsy', ?, 'app_2', datetime('now'), datetime('now'), 'test')`,
      [encryptCredentialPayload(JSON.stringify({
        keystring: 'k'.repeat(24), sharedSecret: 's'.repeat(10),
      }))],
    );
    const html = await connectPage();
    expect(html).not.toContain('One thing first: which application is asking');
    expect(html).toContain('Let me see what it earns');
  });

  it('never renders either half of a stored pair back into the page', async () => {
    const html = await connectPage();
    expect(html).not.toContain('k'.repeat(24));
    expect(html).not.toContain('s'.repeat(10));
  });
});

describe('the key belongs to the institution, so its owner places it', () => {
  let posts: Hono;

  beforeAll(async () => {
    const { settingsRoutes } = await import('../../src/routes/dashboard/settings.js');
    posts = new Hono();
    posts.use('*', async (c, next) => {
      const who = c.req.header('X-Who') ?? 'owner@example.com';
      c.set('founder', { id: F, email: who });
      await next();
    });
    posts.route('/', settingsRoutes);
  });

  /**
   * DELIBERATELY EMPTY, so this suite never reaches Etsy. `setAppCredential`
   * refuses a missing half before it pings anything, which is exactly the
   * shape needed here: the guard either admits the caller or it does not, and
   * a unit test has no business making a live request to a marketplace to find
   * out which.
   */
  const place = (who: string): Promise<Response> => posts.request(
    '/settings/app-credential/etsy',
    {
      method: 'POST', headers: { 'X-Who': who, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ keystring: '', shared_secret: '' }).toString(),
    },
  );

  it('does not ask which company is selected, because none of them owns it', async () => {
    // `requireCompanyCapability` answers a bare 400 "No company selected" when
    // no company cookie is set — a second dead end at the exact step he
    // already could not get through. `app_credentials` has no `product_id`.
    const res = await place('owner@example.com');
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(403);
    // Past the guard and into the handler, which refused the empty pair on its
    // own terms and sent him back to say so.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('etsy_error=');
  });

  it('refuses anyone who is not the owner of this institution', async () => {
    const res = await place('someone.else@example.com');
    expect(res.status).toBe(403);
  });

  it('refuses them the forgetting too', async () => {
    const res = await posts.request('/settings/app-credential/etsy/forget', {
      method: 'POST', headers: { 'X-Who': 'someone.else@example.com' },
    });
    expect(res.status).toBe(403);
  });
});
