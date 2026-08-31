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
// were wrong in both directions. The Letter's day-one empty state turned out to
// be good and hand-written (so counting component uses measured nothing), while
// the single most important link in the product pointed at the wrong page.
//
// "Connect your tools →" sent a founder who had just signed up to
// `/connections`, which asks for a "Tool server address (MCP)" and an access
// token, and mentions Stripe in a footnote at the bottom. The page they wanted
// was `/agents/integrations`. That is also the page that starts the
// institution's loop: a provider sync records external observations, and an MCP
// connection records none — so the first instruction a customer received led
// away from the only door that makes Foundry begin to understand their company.
//
// This renders the product as a new founder receives it and asserts the journey
// rather than the markup.
// =============================================================================

const F = 'f_hour', P = 'p_hour';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email) VALUES (?,?,?)',
    [F, 'c_hour', 'hour@example.com']);
  await query('INSERT INTO products (id,name,owner_id,status) VALUES (?,?,?,?)',
    [P, 'Newco', F, 'active']);

  const mods = await Promise.all([
    import('../../src/routes/dashboard/letter.js'),
    import('../../src/routes/dashboard/agents-integrations.js'),
  ]);
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder', { id: F, email: 'hour@example.com' }); await next(); });
  for (const m of mods) {
    for (const v of Object.values(m)) {
      if (v && typeof v === 'object' && 'routes' in (v as object)) app.route('/', v as never);
    }
  }
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

  it('is pointed at a door that can actually start the loop', async () => {
    const letter = await page('/letter');
    const cta = /href="([^"]+)"[^>]*class="btn btn-primary"[^>]*>\s*Connect/.exec(letter);
    expect(cta, 'the day-one primary call to action is gone').not.toBeNull();

    const href = cta![1];
    // /connections is MCP-only: connecting there records no observation, so the
    // institution learns nothing about the company from it.
    expect(href, 'day one must not send a founder to the MCP server form')
      .not.toBe('/connections');

    const target = await page(href);
    expect(target, `${href} does not offer a real provider to connect`)
      .toMatch(/Stripe/);
  });

  it('finds named providers with a way to connect them', async () => {
    const integrations = await page('/agents/integrations');
    for (const provider of ['Stripe', 'PostHog', 'GitHub']) {
      expect(integrations, `${provider} is not offered`).toContain(provider);
    }
    expect(integrations, 'a provider a founder cannot connect is a screenshot')
      .toMatch(/Save &amp; Connect|Save & Connect/);
  });

  it('says what each provider would let Foundry see', async () => {
    // A list of logos is not an explanation. The reason to connect Stripe is
    // that Foundry then sees revenue reality, and the page has to say so.
    const integrations = await page('/agents/integrations');
    expect(integrations).toMatch(/MRR|churn|revenue/i);
  });
});
