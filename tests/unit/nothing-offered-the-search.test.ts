process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { connectResearchSource } from '../../src/services/venture/research-sources.js';
import { absorbParagraph, readVentureParagraph } from '../../src/services/venture/mandate.js';

// =============================================================================
// NOTHING ON ANY SCREEN OFFERED THE SEARCH.
//
// FOUND IN PRODUCTION, NOT IN A TEST. The deployed institution had never opened
// a venture mandate, and could not have: the whole search card is built only
// when a search already exists, so an owner who has never started one is shown
// nothing about it at all. No sign that Foundry could look for another asset,
// no sign of what it can see through, and no way to begin — while the route to
// begin sat there, reachable by nobody.
//
// A capability the owner cannot discover from his own product is a capability
// he does not have. This is the smallest honest fix: one sentence and one box,
// because the act is his and the act is a sentence.
// =============================================================================

const OWNER = 'offer_owner';

let app: Hono;
/** The real first screen, through the real route. */
async function shell(): Promise<string> {
  const res = await app.request('/foundry');
  return res.text();
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_offer', 'owner@example.com', 'Owner']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

describe('an owner who has never started a search', () => {
  it('is asked to name something he owns before being offered a search', async () => {
    // With no companies at all, offering to go searching was an offer Foundry
    // admitted in the next line it could not keep. The first thing to do when
    // you own nothing is name something you own.
    const body = await shell();
    expect(body).toContain('You have not told me about anything you own');
    expect(body).toContain('action="/foundry/companies"');
  });

  it('offers the search once there is a portfolio to strengthen', async () => {
    await query('INSERT INTO products (id, owner_id, name, status) VALUES (?,?,?,?)',
      ['offer_co', OWNER, 'Tidewater', 'active']);
    const body = await shell();
    expect(body).toContain('I am not looking for anything');
    // The act is a sentence, so the screen asks for a sentence.
    expect(body).toContain('action="/foundry/ask"');
    expect(body).toContain('Start looking');
  });

  it('is honest that it would be starting blind when it has no eyes', async () => {
    // An offer to go looking from an institution with nothing to look through
    // is a promise it cannot keep, and he should be able to tell.
    const body = await shell();
    expect(body).toContain('starting blind');
  });

  it('says what it would be looking through once it has eyes', async () => {
    for (const [type, named] of [['community', 'hn_algolia'], ['directory', 'npm_registry']]) {
      await connectResearchSource({ founderId: OWNER, sourceType: String(type),
        named: String(named), neverGrants: 'contact anyone or spend anything',
        evidenceMode: 'real' });
    }
    const body = await shell();
    expect(body).not.toContain('starting blind');
    expect(body).toContain('What I would be');
  });

  it('stops offering once a search exists, and shows the search instead', async () => {
    await absorbParagraph({ founderId: OWNER, evidenceMode: 'real',
      readings: readVentureParagraph(
        'Find another small digital income stream. Keep legal risk low.') });
    const body = await shell();
    // The two are never both on the screen, which would be the institution
    // asking for something it already has.
    expect(body).not.toContain('I am not looking for anything');
    expect(body).toContain('What I am looking for');
  });
});
