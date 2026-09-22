// =============================================================================
// HE CAN TELL WHETHER IT SAVED.
//
// The owner, 22 September 2026: "I entered my Etsy application keystring and
// shared secret into Foundry's owner interface and submitted the form. The form
// appeared to reset without a clear indication that anything had been saved.
// The interface did not visibly confirm whether the credentials were accepted,
// persisted, rejected, or awaiting further action. I could not tell whether I
// should enter them again or proceed to the next connection step."
//
// He was looking at the SUCCESS path. The POST verifies the pair with Etsy,
// stores it, and redirects with `?etsy=placed&app=…`. Nothing read that
// parameter. The only thing that changed was a 0.82rem line in `--text-dim` and
// a button label, under four paragraphs of explanation.
//
// A state that is right and invisible is worse than one that is wrong, because
// a wrong state can be argued with and an invisible one leaves him deciding
// whether to submit his secrets a second time.
//
// The directive names six states and insists they stay apart, because "a
// successful form submission must not be mistaken for a qualified external
// connection". Every one of them was already a row. What did not exist was one
// reader that knew about all six, so each surface answered from the only row it
// could see.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { etsyJourney } from '../../src/services/senses/journey.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';

const F = 'f_tell', P = 'p_tell';
const KEYSTRING = 'k'.repeat(24);
const SECRET = 'sh4r3ds3cr3t';

let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_tell', 'owner@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Apex Micro', F, 'active']);

  const { settingsRoutes } = await import('../../src/routes/dashboard/settings.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder', { id: F, email: 'owner@example.com' }); await next();
  });
  app.route('/', settingsRoutes);
});

const settings = async (qs = ''): Promise<string> => {
  const res = await app.request(`/settings${qs}`);
  expect(res.status, `/settings${qs} did not render`).toBe(200);
  return res.text();
};

const placeTheKey = async (): Promise<void> => {
  await query(
    `INSERT INTO app_credentials (provider, secret_json, provider_account_ref,
       verified_at, set_at, set_by)
     VALUES ('etsy', ?, '9988776', datetime('now'), datetime('now'), 'test')`,
    [encryptCredentialPayload(JSON.stringify({ keystring: KEYSTRING, sharedSecret: SECRET }))]);
};

describe('the journey knows all six states, and keeps them apart', () => {
  it('starts with no key, and the next thing is his to do', async () => {
    const j = await etsyJourney(P);
    expect(j.stage).toBe('no_key');
    expect(j.next?.href).toContain(`/foundry/companies/${P}/see/`);
    // Not a technical instruction. The directive: "Make the next legitimate
    // action immediately discoverable."
    expect(j.next?.say).toContain('application key');
  });

  it('says nothing has been reached that has not been', async () => {
    const j = await etsyJourney(P);
    expect(j.steps.every((s) => !s.done)).toBe(true);
  });

  it('moves to authorization pending once the key is verified, and no further', async () => {
    await placeTheKey();
    const j = await etsyJourney(P);
    // THE DISTINCTION THE OWNER WAS DENIED. A saved credential is not a
    // connected shop, and it is certainly not a qualified capability.
    expect(j.stage).toBe('authorization_pending');
    const done = j.steps.filter((s) => s.done).map((s) => s.stage);
    expect(done).toEqual(['key_verified']);
    expect(j.next?.say).toContain('Connect the shop');
  });

  it('carries the application id Etsy itself returned, and neither half of the pair', async () => {
    const j = await etsyJourney(P);
    const step = j.steps.find((s) => s.stage === 'key_verified')!;
    expect(step.evidence).toContain('9988776');
    expect(JSON.stringify(j)).not.toContain(KEYSTRING);
    expect(JSON.stringify(j)).not.toContain(SECRET);
  });

  it('reaches connected on an authorisation, and stops short of qualified', async () => {
    const r = (await query(
      "SELECT sense_key, mode FROM sense_providers WHERE provider = 'etsy' LIMIT 1"))
      .rows[0] as Record<string, unknown>;
    await query(
      `INSERT INTO company_senses (id, product_id, sense_key, provider, mode, disclosure)
       VALUES (?,?,?,?,?,?)`,
      ['cs_tell', P, String(r.sense_key), 'etsy', String(r.mode), 'I would read the shop.']);
    const j = await etsyJourney(P);
    expect(j.stage).toBe('connected');
    // Authorised and never exercised. Nothing for him to do, and saying so is
    // better than inventing a button.
    expect(j.next?.href).toBeNull();
    expect(j.steps.find((s) => s.stage === 'qualified')!.done).toBe(false);
  });

  it('reaches identity verified only when the provider actually answered', async () => {
    await query(
      `UPDATE company_senses SET provider_account_ref = ?, provider_account_label = ?,
              identity_verified_at = datetime('now') WHERE id = 'cs_tell'`,
      ['12345678', 'ApexMicro']);
    const j = await etsyJourney(P);
    expect(j.stage).toBe('identity_verified');
    expect(j.steps.find((s) => s.stage === 'identity_verified')!.evidence).toContain('ApexMicro');
    // WHAT THE NEXT THING IS, once Etsy has named the shop: his recognition.
    // This asserted 'not read anything through it yet' — the sentence from
    // before migration 347, when a verified identity was the end of the
    // journey and the only thing left was waiting for a read. It is not: the
    // provider naming a shop is precisely the moment the one question that is
    // his becomes askable, and a stale assertion here would have kept passing
    // while the page moved on without it.
    expect(j.next?.say).toContain('Is that your shop?');
    expect(j.next?.say).toContain('ApexMicro');
  });

  it('reaches qualified only when the capability was exercised for real', async () => {
    // Not when a credential exists, not when a shop is named — when the ladder
    // records a witnessed real read. `witnessAReading` is the only writer, and
    // the trigger refuses `reality_proven` for evidence that is not real.
    expect((await etsyJourney(P)).stage).toBe('identity_verified');
    const { witnessAReading } = await import('../../src/services/senses/witness.js');
    await witnessAReading({
      provider: 'etsy', evidenceMode: 'real', to: 'reality_proven',
      evidence: 'read ApexMicro (12345678) from Etsy: 0 listings, 0 paid orders',
      witnessedBy: 'test',
    });
    const j = await etsyJourney(P);
    expect(j.stage).toBe('qualified');
    expect(j.next).toBeNull();
  });

  it('never stops saying what none of it permits, including at the end', async () => {
    // Reaching the last step proves a reading works. It grants nothing, and a
    // panel that went quiet about that once everything was green would teach
    // the exact collapse the institution refuses everywhere else.
    const j = await etsyJourney(P);
    expect(j.grantsNothing).toContain('Publishing a listing');
    expect(j.grantsNothing).toContain('moving money');
  });
});

describe('the page he submitted into tells him what happened', () => {
  it('acknowledges the save that the redirect already carried', async () => {
    // The whole defect: this parameter was written by the POST and read by
    // nothing.
    const html = await settings('?etsy=placed&app=9988776');
    expect(html).toContain('Saved.');
    expect(html).toContain('9988776');
  });

  it('says plainly when it was not saved, rather than looking identical', async () => {
    const html = await settings('?etsy_error=Etsy%20refused%20that%20pair');
    expect(html).toContain('Not saved.');
    expect(html).toContain('Etsy refused that pair');
  });

  it('shows where the connection actually is, on the page itself', async () => {
    const html = await settings();
    expect(html).toContain('Application key saved, and checked with Etsy');
    expect(html).toContain('Shop identity read back');
  });

  it('never returns either half of the stored pair to the browser', async () => {
    // "Never display the stored shared secret or expose it through logs,
    // rendered HTML, or the browser response." Asserted against the real
    // response body, with a credential genuinely stored.
    for (const qs of ['', '?etsy=placed&app=9988776']) {
      const html = await settings(qs);
      expect(html, qs).not.toContain(SECRET);
      expect(html, qs).not.toContain(KEYSTRING);
    }
  });

  it('survives a refresh, because the state is rows and not a flash', async () => {
    // The banner is a response to an action and goes; the journey is derived
    // from rows and stays. Refreshing must not make him wonder again.
    const plain = await settings();
    expect(plain).not.toContain('Saved.');
    expect(plain).toContain('Application key saved, and checked with Etsy');
  });
});
