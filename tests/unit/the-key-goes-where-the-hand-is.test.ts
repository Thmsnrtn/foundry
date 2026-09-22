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

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whatStandsBetween } from '../../src/services/senses/credentials.js';
import { safeBackPath } from '../../src/routes/dashboard/settings.js';
import { senseProvider } from '../../src/services/senses/providers/contract.js';
import { encryptCredentialPayload } from '../../src/services/encryption.js';

beforeAll(async () => {
  await runMigrations();
});

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

  it('puts both halves of the pair on the connect page itself', () => {
    const flat = shell.replace(/\s+/g, ' ');
    expect(flat).toContain("name=\"keystring\"");
    expect(flat).toContain("name=\"shared_secret\"");
    expect(flat).toContain('action="/settings/app-credential/etsy"');
  });

  it('carries the way back, so satisfying a prerequisite lands where it started', () => {
    const flat = shell.replace(/\s+/g, ' ');
    expect(flat).toContain('name="back"');
    expect(flat).toContain('/foundry/companies/${productId}/see/${gap.key}');
  });

  it('says the key grants no access to any shop, which is the fact he is owed', () => {
    const flat = shell.replace(/\s+/g, ' ');
    expect(flat).toContain('they give no access to');
  });

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

  it('leaves the keystring readable, because it is an identifier', () => {
    // It travels in the open as `client_id` on the consent URL he is about to
    // look at. Dots over it protect nothing and cost him the ability to see
    // that a 24-character paste arrived whole.
    const flat = settings.replace(/\s+/g, ' ');
    expect(flat).toContain('<input type="text" name="keystring"');
  });

  it('keeps the shared secret hidden', () => {
    const flat = settings.replace(/\s+/g, ' ');
    expect(flat).toContain('<input type="password" name="shared_secret"');
  });

  it('still never renders a stored secret back', () => {
    // Placing it is the last time either half is in a page. `appCredentialFor`
    // returns the pair to code; the card shows the application id and a date.
    const flat = settings.replace(/\s+/g, ' ');
    expect(flat).toContain('etsyApp.providerAccountRef');
    expect(flat).not.toContain('etsyApp.secret');
  });
});
