// =============================================================================
// CONNECTORS IS A PLACE, NOT THE SETTINGS FORM MOVED.
//
// The owner, 22 September 2026: "Do not simply relocate the existing settings
// form. Design the complete interaction around establishing, understanding,
// managing, and governing real external account connections."
//
// And the thing it must never do: "Distinguish four separate facts: the
// provider supports an operation; the connection grants the necessary technical
// permissions; Foundry has qualified the capability to perform the operation
// reliably; my current institutional authority permits the operation. Do not
// collapse these into a single green Connected status."
//
// So this drives the real routes and checks the four facts are four, that the
// list is short enough to be a list, and that no disconnect control ships
// before the dependency reading the directive requires in front of it.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { connectorsFor } from '../../src/services/senses/journey.js';

const F = 'f_conn', P = 'p_conn';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_conn', 'owner@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'owner@example.com' }); await next();
  });
  app.route('/', foundryShellRoutes);
});

const get = async (path: string): Promise<string> => {
  const res = await app.request(path);
  expect(res.status, `${path} did not render`).toBe(200);
  return res.text();
};

describe('the list answers his four questions and stops', () => {
  it('renders, from a door that already exists', async () => {
    // Controls → Connectors. No new bottom-nav item: the phone path is
    // More → Controls → Connectors, and the five-door assertion is what keeps
    // that a fact rather than an intention.
    const html = await get('/foundry/controls/connectors');
    expect(html).toContain('Connectors');
  });

  it('names every provider the institution has declared, not only the coded ones', async () => {
    const all = await connectorsFor(P);
    expect(all.length).toBeGreaterThan(1);
    expect(all.map((x) => x.provider)).toContain('etsy');
  });

  it('says where each one is in one line, rather than explaining itself first', async () => {
    const html = await get('/foundry/controls/connectors');
    // The state Etsy is actually in with nothing placed.
    expect(html).toContain('Needs its application key');
  });

  it('keeps the list a list — the restraint is the feature', async () => {
    // The page he could not use explained itself before it showed him
    // anything. A word count is a blunt instrument and it is the right one
    // here: this page exists to be scanned.
    const html = await get('/foundry/controls/connectors');
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    expect(text.split(' ').length).toBeLessThan(220);
  });

  it('still says a connection never confers the power to act', async () => {
    // Whitespace-normalised: the copy wraps in the source and a line break is
    // not a change of meaning.
    const flat = (await get('/foundry/controls/connectors')).replace(/\s+/g, ' ');
    expect(flat).toContain('It never lets me act');
    expect(flat).toContain('moving money each need');
  });
});

describe('he can find it, which is the first thing', () => {
  // A page reachable only by typing its URL is a page that does not exist.
  // The Connectors route shipped with zero links to it — the same defect as
  // the buried form, one layer up, and caught the same way: by asking whether
  // the journey starts rather than whether the destination renders.
  it('is linked from Controls, which is where he would look', async () => {
    const html = await get('/foundry/controls');
    expect(html).toContain('href="/foundry/controls/connectors"');
  });

  it('counts real connections rather than a typed repository URL', async () => {
    // The card read `product.github_repo_url ? ['its code'] : []` — it told an
    // owner with a live credential that he was connected to nothing.
    const html = await get('/foundry/controls');
    expect(html).toContain('Nothing connected');
    expect(html).not.toContain('I have no way to see your code, your money or your customers');
  });
});

describe('the detail keeps four facts as four', () => {
  it('renders all four, separately, with nothing placed', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('offers a way to read this');
    expect(html).toContain('You have not granted me any permission');
    expect(html).toContain('I have not yet done it for real');
    expect(html).toContain('Nothing here is authorised');
  });

  it('says out loud that they are four different things', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('These are four different things');
    expect(html).toContain('tells you nothing about the fourth');
  });

  it('shows the journey for the provider that has one', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('Where this has got to');
    expect(html).toContain('Application key saved, and checked with Etsy');
  });

  it('does not invent a journey for a provider that has none', async () => {
    const all = await connectorsFor(P);
    const other = all.find((x) => x.provider !== 'etsy')!;
    const html = await get(`/foundry/controls/connectors/${other.provider}`);
    expect(html).not.toContain('Where this has got to');
  });

  it('ships no disconnect control, because the dependency reading does not exist yet', async () => {
    // "Before disconnecting a consequential service, show the affected assets
    // and operating responsibilities." That reading is not built. Shipping the
    // button without it is the one thing the directive forbids shipping bare,
    // so the control stays where it already lives with its revocation
    // reporting, and this asserts the absence rather than trusting it.
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).not.toContain('/disconnect');
  });

  it('refuses a provider that does not exist', async () => {
    const res = await app.request('/foundry/controls/connectors/nonesuch');
    expect(res.status).toBe(404);
  });
});

describe('the one thing he has to do at Etsy, where he would look for it', () => {
  // He cannot guess this value and nothing was telling him. Etsy refuses an
  // authorization whose redirect_uri is not registered on the application, and
  // Foundry derives that address from the host the request arrived on — never
  // from configuration, because an attacker who could choose it could send the
  // authorization code somewhere else. Without it on the page he would paste
  // both secrets correctly and meet a provider error with no idea which was
  // wrong.
  it('shows the exact address to register while the connection is still unmade', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('First, at Etsy');
    expect(html).toContain('/foundry/senses/callback');
  });

  it('works it out from the address he is reading it on, not from a setting', async () => {
    const res = await app.request('https://example.test/foundry/controls/connectors/etsy');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('https://example.test/foundry/senses/callback');
  });
});

describe('a connector that is connected reads differently from one that is not', () => {
  beforeAll(async () => {
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_conn', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    await query(
      `UPDATE company_senses SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now') WHERE id = 'cs_conn'`,
      ['12345678', 'ApexMicro']);
  });

  it('names the account on the list, not just the provider', async () => {
    expect(await get('/foundry/controls/connectors')).toContain('ApexMicro');
  });

  it('separates granted from qualified, which is the whole point', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    // Granted: he authorised it. Qualified: nothing has actually been read.
    expect(html).toContain('You have granted me the permission to');
    expect(html).toContain('I have not yet done it for real');
  });

  it('says nothing has been read yet rather than calling it working', async () => {
    expect(await get('/foundry/controls/connectors')).toContain('nothing read yet');
  });
});

describe('the provider says which account; he says whether it is the one', () => {
  // "The first successful Etsy read can establish which account the
  // authorization actually reaches. It cannot, by itself, establish that this
  // is the shop I intended to connect." Two facts, two authors, two columns.
  const confirm = async (): Promise<Response> => app.request(
    '/foundry/controls/connectors/etsy/confirm', { method: 'POST' });

  it('asks him, once the provider has named the account', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('Is this your shop?');
    expect(html).toContain('ApexMicro');
    expect(html).toContain('Yes, ApexMicro is my shop');
  });

  it('will not act on his behalf through a shop he has not recognised', async () => {
    const all = await connectorsFor(P);
    const etsy = all.find((x) => x.provider === 'etsy')!;
    expect(etsy.accountVerified).toBe(true);
    expect(etsy.accountConfirmed).toBe(false);
    // Authority waits on him. The grant is unaffected — it is a different fact.
    expect(etsy.authorised).toBe(false);
    expect(etsy.granted).toBe(true);
  });

  it('records the recognition, and says so afterwards', async () => {
    const res = await confirm();
    expect(res.status).toBe(302);
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('You confirmed');
    expect(html).not.toContain('Is this your shop?');
    const all = await connectorsFor(P);
    const etsy = all.find((x) => x.provider === 'etsy')!;
    expect(etsy.accountConfirmed).toBe(true);
    expect(etsy.authorised).toBe(true);
  });

  it('does not erase or redefine the fact that Etsy granted access', async () => {
    // Confirmation is additive. Anyone reconstructing an incident needs the
    // original grant to still say what it said.
    const row = (await query(
      `SELECT connected_at, identity_verified_at, identity_confirmed_at, identity_confirmed_by
         FROM company_senses WHERE id = 'cs_conn'`)).rows[0] as Record<string, unknown>;
    expect(row.connected_at).toBeTruthy();
    expect(row.identity_verified_at).toBeTruthy();
    expect(row.identity_confirmed_at).toBeTruthy();
    expect(String(row.identity_confirmed_by)).toContain('founder:');
  });

  it('confirming is still not qualification, and still not a licence to act', async () => {
    const all = await connectorsFor(P);
    const etsy = all.find((x) => x.provider === 'etsy')!;
    // He has recognised the shop. Nothing has read it.
    expect(etsy.qualified).toBe(false);
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('I have not yet done it for real');
    expect(html.replace(/\s+/g, ' ')).toContain('none of them comes from this');
  });

  it('refuses a confirmation the provider has not named an account for', async () => {
    // The trigger is the real guard; the route asks first so he gets a page
    // rather than a database error. Proven against the DB directly.
    // A SECOND REAL COMPANY, because migration 226 refuses a reference sense on
    // a real company and the live Etsy slot on this one is taken — the unique
    // index is (product_id, sense_key) where not disconnected.
    await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
      ['p_conn2', 'Second', F, 'active']);
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       SELECT 'cs_unverified', 'p_conn2', sense_key, 'etsy', mode, 'I would read the shop.'
         FROM sense_providers WHERE provider = 'etsy' LIMIT 1`);
    await expect(query(
      `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
              identity_confirmed_by = 'founder:x' WHERE id = 'cs_unverified'`))
      .rejects.toThrow(/nothing_to_confirm/);
  });

  it('refuses a confirmation with nobody behind it', async () => {
    await expect(query(
      `UPDATE company_senses SET identity_confirmed_at = datetime('now'),
              identity_confirmed_by = '' WHERE id = 'cs_conn'`))
      .rejects.toThrow(/needs_a_confirmer/);
  });

  it('refuses to un-confirm by editing, because that is what disconnecting is', async () => {
    // Blanking the column would leave a live credential reaching a shop he has
    // decided is not his, with nothing saying so.
    await expect(query(
      "UPDATE company_senses SET identity_confirmed_at = NULL WHERE id = 'cs_conn'"))
      .rejects.toThrow(/disconnect_instead/);
  });
});

describe('the provider starts naming somebody else, and the page leads with it', () => {
  // "Where identity evidence actually contradicts the recognized account, stop
  // newly initiated consequential operations through that connection, preserve
  // the relevant evidence, and surface the disagreement through the existing
  // founder interface."
  //
  // `cs_conn` is verified AND confirmed by the block above — the most
  // dangerous state a dispute can arrive in, because every surface reads as
  // fully recognised while the account on the other end is somebody else's.
  beforeAll(async () => {
    await query(
      `UPDATE company_senses SET identity_disputed_at = datetime('now'),
              identity_disputed_ref = '99999999',
              identity_disputed_detail = 'SomeoneElse (99999999)' WHERE id = 'cs_conn'`);
  });

  it('says it on the list, instead of the word Working', async () => {
    const html = await get('/foundry/controls/connectors');
    expect(html).toContain('Not the account you recognised');
  });

  it('leads the detail page with it, above everything else on the page', async () => {
    const html = await get('/foundry/controls/connectors/etsy');
    const flat = html.replace(/\s+/g, ' ');
    expect(flat).toContain('This is not the account you recognised');
    expect(flat).toContain('SomeoneElse (99999999)');
    // Preserved and shown, rather than a state with no evidence behind it.
    expect(flat).toContain('Nothing has been changed, published or sent');
  });

  it('takes the authority and leaves his recognition standing', async () => {
    const etsy = (await connectorsFor(P)).find((x) => x.provider === 'etsy')!;
    expect(etsy.authorised).toBe(false);
    expect(etsy.accountConfirmed).toBe(true);
    const html = await get('/foundry/controls/connectors/etsy');
    expect(html).toContain('that record stands exactly');
    expect(html).toContain('Nothing here is authorised');
  });

  it('will not take a confirmation while it stands', async () => {
    // Confirming here would record him recognising a shop this grant no longer
    // opens. He is sent back to the page, which now leads with the reason.
    const res = await app.request('/foundry/controls/connectors/etsy/confirm', { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/foundry/controls/connectors/etsy');
  });

  it('asks him for the smallest thing, which is a choice and not a repair', async () => {
    const flat = (await get('/foundry/controls/connectors/etsy')).replace(/\s+/g, ' ');
    expect(flat).toContain('disconnect this connection');
    expect(flat).toContain('I will ask you about it once');
  });
});
