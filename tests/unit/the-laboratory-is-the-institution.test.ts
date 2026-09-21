// =============================================================================
// THE REVIEW INSTRUMENT IS THE INSTITUTION, NOT A COPY OF IT.
//
// The laboratory a reviewer walks used to list the owner's routers by hand,
// and it had drifted: the letter, settings and the privacy page where taking a
// copy of the data and deleting it live all answered 404 there and nowhere
// else. Two independent reviewers reported the owner's own exit doors as
// broken. They were not broken — the laboratory was smaller than the thing it
// was reviewing, which is this campaign's own subject wearing a different
// coat: a process running correctly against its internal state while what it
// is supposed to observe is not there.
//
//   every door the product links to answers → the buyer's door answers →
//   the deliberate absences are named with reasons a person can check →
//   and the harness refuses to start where a real provider credential is.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NOT_MOUNTED_IN_THE_LABORATORY, OWNER, owner, ownerApp, seedProductionShape } from '../helpers/world.js';

let app: Awaited<ReturnType<typeof ownerApp>>;
let me: ReturnType<typeof owner>;

beforeAll(async () => {
  // THE WORLD AS IT RAN, because the buyer's door is only a page when there
  // is a buyer: the exposure a purchase is reported at is the world's own.
  await seedProductionShape({ settledBy: 'the world' });
  app = await ownerApp();
  me = owner(app);
});

describe('every door the owner is shown is a door the laboratory has', () => {
  it('the places, the letter, settings and the privacy page all answer', async () => {
    for (const path of ['/foundry', '/foundry/experiments', '/foundry/controls', '/foundry/money',
      '/foundry/inbox', '/foundry/activity', '/letter', '/settings', '/privacy']) {
      expect((await app.request(path)).status, `${path} answers in the laboratory`).toBeLessThan(400);
    }
  });

  it("the buyer's door answers too, which no review had ever walked", async () => {
    // A customer who paid follows a signed link to ask for their money back.
    // It is a supported journey of this institution and it was not reachable
    // in the laboratory at all, so no review had ever walked it. The purchase
    // comes from the same fixture the review harness uses, so a reviewer and
    // a proof are looking at one sale rather than two descriptions of one.
    const { aBuyerIsOwedARefund } = await import('../helpers/world.js');
    const { refundLinkFor } = await import('../../src/services/venture/hand.js');
    const { fulfilmentId } = await aBuyerIsOwedARefund(OWNER);
    const link = refundLinkFor(fulfilmentId);
    const r = await app.request(link.slice(link.indexOf('/share/')));
    expect(r.status, 'the buyer can open their own refund link in the laboratory').toBe(200);
    expect(await r.text()).toMatch(/Refund \$29\.00\?|Already refunded/);
    // And a link nobody signed is refused rather than served.
    expect((await app.request(`/share/refund/${fulfilmentId}/not-a-signature`)).status).toBe(404);
  });

});

describe('the differences between the laboratory and the institution are stated', () => {
  it('each deliberate absence names a reason about the product', () => {
    const absences = Object.entries(NOT_MOUNTED_IN_THE_LABORATORY);
    expect(absences.length).toBeGreaterThan(0);
    for (const [name, why] of absences) {
      expect(why.length, `${name} has a reason worth reading`).toBeGreaterThan(20);
      // "It is hard to mount" is not a reason. Every one of these is a claim
      // about what the journey IS, which a person can check against the code.
      expect(why, `${name}: the reason is about the product, not about the harness`)
        .not.toMatch(/hard to|difficult|too complex|TODO|later/i);
    }
  });

  it('and the one deliberate untruth — always signed in — is written down where it is done', async () => {
    const { readFileSync } = await import('node:fs');
    const world = readFileSync(resolve(process.cwd(), 'tests/helpers/world.ts'), 'utf-8');
    expect(world).toContain('always signed in as the owner');
    expect(world).toMatch(/deliberate untruth/);
  });

  it('the gate refuses a laboratory smaller than the institution', () => {
    const r = execFileSync('node',
      [resolve(process.cwd(), 'scripts/check-the-laboratory-is-the-institution.mjs')],
      { cwd: process.cwd(), encoding: 'utf8' });
    expect(r).toContain('the laboratory mounts what production mounts');
  });
});

describe('and the laboratory never reaches a real provider', () => {
  it('the review harness refuses to start when a real credential is in the environment', () => {
    // NOT A CONVENTION, A REFUSAL. The stubs install on globalThis.fetch, and
    // a harness started beside a real token is one keystroke from writing to
    // somebody. It exits rather than trusting itself.
    let code = 0; let output = '';
    try {
      execFileSync('npx', ['tsx', resolve(process.cwd(), 'scripts/owner-review-harness.mts'), '--port', '4399'],
        { cwd: process.cwd(), encoding: 'utf8',
          env: { ...process.env, RESEND_API_KEY: 're_looks_real', TURSO_DATABASE_URL: 'file::memory:' },
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1; output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
    expect(code, output).toBe(2);
    expect(output).toContain('RESEND_API_KEY');
    expect(output).toMatch(/run with --world .*stubbed providers.* or unset them/);
  });

  it('the world itself installs the stubs before any provider module is imported', async () => {
    const { readFileSync } = await import('node:fs');
    const world = readFileSync(resolve(process.cwd(), 'tests/helpers/world.ts'), 'utf-8');
    expect(world).toContain('THE STUBS GO IN BEFORE ANY PROVIDER MODULE IS IMPORTED');
    // And the Cloudflare account the stub answers for is fixed, so a token
    // for a real account cannot be exercised by accident.
    expect(world).toContain("process.env.CLOUDFLARE_ACCOUNT_ID = 'acct_test'");
    expect(OWNER).toBe('wd_owner');
  });
});
