process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// A PAGE REACHABLE ONLY BY TYPING ITS URL IS A PAGE THAT DOES NOT EXIST.
//
// Connectors shipped that way once and this campaign wrote the sentence down.
// It then happened again, to a worse page: `/connections` is the TOOL-SERVER
// door — paste an MCP server's URL and its tools become reachable, and every
// tool then needs a grant of its own, scoped, capped and revocable. Mounted,
// behind auth and CSRF, rendering fine, and linked from nowhere in the whole
// product. Its own breadcrumb said Controls, which is where it thought it was.
//
// The revoke controls are the half that matters: an authority the owner cannot
// reach to withdraw is worse than one he never granted. It had been that way
// since the Letter's connect link moved to Controls and nothing brought the
// page along.
//
// WHY NOTHING CAUGHT IT. `check-reachability` walks the MODULE import graph,
// where a mounted router is reached by definition. The browser review renders
// what it is pointed at. Neither asks the navigation question, which is not
// "does this page exist" but "can he get there".
//
// So this one boots the owner surface, renders every page it can, collects
// every href those pages carry, and asks of each page whether anything points
// at it.
//
// WHAT IT DOES NOT COVER, SAID HERE RATHER THAN DISCOVERED LATER. It asks the
// question only of pages with no parameter in their path. A company's
// economics page is linked from that company when that company HAS economics,
// and this fixture seeds one empty company, so every parameterised sub-page
// reads as an orphan for a reason that is not the defect. Checking them needs
// a populated fixture — a company with each dimension, an experiment at each
// state, a thread — and until that exists, claiming to check them would be
// the same failure as the page list that claimed to be every page.
//
// A GET that answers with a redirect is a signpost rather than a page, and is
// detected as one rather than listed: `/autopilot` is a permanent 308 to
// Controls, kept for old links, and wanting a door for it would be asking the
// product to link its own history.
// =============================================================================

const OWNER = 'rx_owner';

/** Where a session starts, so nothing inside has to point at it. */
const ENTRANCES = new Set(['/foundry', '/onboarding']);

/**
 * Pages whose door is a form's destination rather than a plain href, and the
 * GETs that answer with a file. Each is a real journey; none is "we will link
 * it later".
 */
const REACHED_ANOTHER_WAY = new Set([
  '/foundry/senses/reference-authorize', // arrived at from a provider's consent screen
  '/settings/add-product',               // posted to from Settings' add form
  '/settings/delete-all-products',       // reached from Privacy's erasure flow
  '/privacy/export', '/privacy/export-account', '/settings/export-all', // downloads
  '/foundry/senses/callback',            // an OAuth landing
  '/static/:file',                       // the stylesheet and the script
]);

/** GETs that answered with a redirect: signposts, not pages. */
const signposts = new Set<string>();

let pages: string[] = [];
let linked = new Set<string>();

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_rx', 'owner@example.com', 'Thomas Norton']);
  await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
    ['rx_apex', 'Apex Micro', OWNER, 'active', 'active']);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  for (const mod of [
    '../../src/routes/dashboard/foundry-shell.js',
    '../../src/routes/dashboard/settings.js',
    '../../src/routes/dashboard/experiments-place.js',
    '../../src/routes/dashboard/charter-place.js',
    '../../src/routes/dashboard/places.js',
    '../../src/routes/dashboard/inbox-place.js',
    '../../src/routes/dashboard/money-place.js',
    '../../src/routes/dashboard/activity-place.js',
    '../../src/routes/dashboard/absence-place.js',
    '../../src/routes/dashboard/letter.js',
    '../../src/routes/dashboard/privacy.js',
    '../../src/routes/dashboard/connections.js',
  ]) {
    const loaded = await import(mod) as Record<string, unknown>;
    for (const v of Object.values(loaded)) {
      if (v && typeof v === 'object' && 'routes' in (v as Record<string, unknown>)) {
        app.route('/', v as never);
      }
    }
  }

  pages = [...new Set(app.routes.filter((r) => r.method === 'GET').map((r) => r.path))];
  // Every href on every page that answers, so the question is asked of what
  // the owner actually sees rather than of the source.
  const hrefs = new Set<string>();
  for (const path of pages) {
    if (path.includes(':') || path.includes('*')) continue;
    const res = await app.request(path);
    if (res.status >= 300 && res.status < 400) { signposts.add(path); continue; }
    if (res.status !== 200) continue;
    for (const m of (await res.text()).matchAll(/href="([^"#?]+)/g)) hrefs.add(m[1]!);
  }
  linked = hrefs;
});

describe('every owner page has a door', () => {
  it('found the surface at all', () => {
    expect(pages.length, 'no GET routes — the harness mounted nothing').toBeGreaterThan(20);
    expect(linked.size, 'no links found — the pages did not render').toBeGreaterThan(20);
  });

  it('leaves no page that only a typed URL can reach', () => {
    const orphans = pages.filter((p) => {
      if (p.includes('*') || p.includes(':')) return false; // see the header
      if (ENTRANCES.has(p) || REACHED_ANOTHER_WAY.has(p) || signposts.has(p)) return false;
      return !linked.has(p);
    });
    expect(orphans, `${String(orphans.length)} owner page(s) are reachable only by typing the URL`)
      .toEqual([]);
  });
});
