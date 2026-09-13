process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE FIRST HOUR, RENDERED RATHER THAN COUNTED.
//
// Every previous read of this product was a repository proxy — inline-style
// counts, uses of the `emptyState` component, nav-item totals — and the proxies
// were wrong in both directions. Counting component uses measured nothing,
// because the Letter's day-one empty state turned out to be good and
// hand-written: it says WHY there is nothing on the page rather than leaving a
// new founder looking at a blank one. That is the thing worth holding, and the
// only way to see it is to render the page as a founder who signed up a minute
// ago actually receives it.
//
// THIS FILE USED TO GO FURTHER AND FOLLOW THE DAY-ONE LINK. The single most
// important link in the product pointed at `/connections` — the MCP server form
// — rather than at the provider-integrations page, which is the door that
// starts the institution's loop, because a provider sync records external
// observations and an MCP connection records none. That integrations page was
// part of the Commercial Foundry surface and has been removed, so there is no
// longer a live provider-connect door for the link to be measured against and
// those assertions went with it. What remains below is the half that still has
// a live subject.
// =============================================================================

const F = 'f_hour', P = 'p_hour';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_hour', 'hour@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Newco', F, 'active']);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder', { id: F, email: 'hour@example.com' }); await next(); });
  app.route('/', letterRoutes);
});

async function page(path: string): Promise<string> {
  const res = await app.request(path);
  expect(res.status, `${path} did not render for a brand-new company`).toBe(200);
  return res.text();
}

describe('a founder who just signed up', () => {
  it('is told why the Letter is empty, not shown a blank page', async () => {
    const letter = await page('/letter');
    expect(letter).toMatch(/no data yet|day one/i);
  });

  it('is given something to do about it, not only told to wait', async () => {
    // An empty state that explains itself and then offers nothing is still a
    // dead end. The day-one Letter has to hand the founder a next step.
    const letter = await page('/letter');
    expect(letter, 'the day-one primary call to action is gone')
      .toMatch(/class="btn btn-primary"/);
  });
});
