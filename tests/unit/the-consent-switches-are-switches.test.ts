process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE CONSENT SWITCHES ARE SWITCHES.
//
// `toggle()` in `privacy.ts` returned a plain string of markup into an `html`
// template, which escapes one. So all four consent controls on the Privacy page
// rendered their own source as visible text — `<label class="toggle"
// for="toggle-benchmarking">` printed on the page — and there was no control to
// set. The owner could not record a privacy preference at all.
//
// WHAT WAS WATCHING, AND WHY NONE OF IT SAW.
//
//   · The route answered 200, with a body, containing the word "benchmarking".
//   · `a-privacy-toggle-that-governs-nothing` checks that a set toggle changes
//     what the institution does — it posts to `/privacy/consent` and reads the
//     ledger. Every one of those assertions was true. The semantics were
//     correct; the control was not there.
//   · The browser review renders every owner surface in three appearances, and
//     Privacy was not in its list of pages.
//
// Three instruments, none of which had looked at the page. This one looks at
// the page: it asserts checkboxes exist, one per consent the route accepts, and
// that no escaped tag is sitting in the body — because the failure's whole
// signature is markup arriving as text.
// =============================================================================

const OWNER = 'cs_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_cs', 'owner@example.com', 'Thomas Norton']);
  await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
    ['cs_p', 'Apex Micro', OWNER, 'active', 'active']);
  const { privacySettings } = await import('../../src/routes/dashboard/privacy.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', privacySettings);
});

/** The consent types the page offers and the route accepts. */
const CONSENTS = [
  'benchmark_contribution', 'aggregate_insights', 'product_improvement', 'ai_training_opt_out',
];

describe('the owner can actually set a privacy preference', () => {
  it('draws one real checkbox for every consent it offers', async () => {
    const res = await app.request('/privacy');
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const name of CONSENTS) {
      expect(body, `${name} has no control`)
        .toContain(`<input type="checkbox" id="toggle-${name}" name="${name}"`);
    }
  });

  it('prints no markup as text, which is what the failure looked like', async () => {
    const body = await (await app.request('/privacy')).text();
    // The signature: an escaped opening tag in the body. `&lt;` inside prose is
    // legitimate, so this pins the shape that only quoted markup produces.
    const quoted = [...body.matchAll(/&lt;(\/?[a-z][a-z0-9]*)[ &]/g)].map((m) => m[1]);
    expect([...new Set(quoted)], 'markup is being shown to the owner as text')
      .toEqual([]);
  });

  it('puts each switch inside the form that submits it', async () => {
    // A control outside its form is the same defect one layer up: it renders,
    // it can be tapped, and nothing is recorded.
    const body = await (await app.request('/privacy')).text();
    for (const name of CONSENTS) {
      const at = body.indexOf(`id="toggle-${name}"`);
      expect(at, `${name} is not on the page`).toBeGreaterThan(0);
      const formOpen = body.lastIndexOf('<form', at);
      const formClose = body.lastIndexOf('</form>', at);
      expect(formOpen, `${name} is not inside a form`).toBeGreaterThan(formClose);
      const scope = body.slice(formOpen, at);
      expect(scope, `${name}'s form does not post the consent type`)
        .toContain(`value="${name}"`);
    }
  });
});
