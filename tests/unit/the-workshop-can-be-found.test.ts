process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '5'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { renderSite, renderRobots, renderSitemap, PUBLIC_PATHS, PUBLIC_FILES, UNINDEXED } from '../../src/services/public-workshop/site.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';

// =============================================================================
// THE WORKSHOP CAN BE FOUND.
//
// A page nobody can find is silence with a receipt. The eyes hear what people
// search for, the forge composes an offer on those very words, and the page
// that carries it is the one place a stranger could pay — so the page must be
// findable on those words, or the loop ends one step short of the world.
//
// Held here: every indexable page names its one address; the pages that are
// for the person in front of them (opt-out, receipts, not-found) say they are
// not for an index; the sitemap announces exactly the indexable pages and the
// listed experiments; an offer that is actually for sale says so in the form
// an index reads, and a closed one does not; the program serves the two files
// as what they are and refuses every other dot; the row guard admits exactly
// those two paths.
// =============================================================================

const F: PublicWorkshopFacts = {
  name: 'Apex Micro', legalOperator: 'Somebody', origin: 'https://apexmicro.ai', tagline: 'a small digital workshop in Massachusetts',
  statement: 'Apex Micro makes small things.', about: 'About.', contactEmail: 'hello@apexmicro.ai', postalAddress: null, region: 'Massachusetts',
};
const experiment = (over: Partial<PublicExperiment>): PublicExperiment => ({
  number: 1, slug: 'brief', path: '/experiments/brief', listed: true,
  title: 'A brief', summary: 'What it is.', who: 'Who.', what: 'What.', limits: 'Limits.', sources: 'Sources.', selection: 'Selection.', note: '',
  sample: null, status: 'testing', statusLabel: 'Testing', statusLine: 'Testing now.', outcome: null,
  price: { amountCents: 2900, currency: 'usd', label: '$29, one time' }, recurring: false, payUrl: 'https://buy.stripe.com/x',
  openedOn: '2026-09-01', closedOn: null, updatedOn: '2026-09-01', supersedes: null, successor: null, graduatedTo: null,
  ...over,
} as PublicExperiment);

beforeAll(async () => { await runMigrations(); });

describe('every page names its one address, or says it is not for an index', () => {
  const pages = renderSite(F, [experiment({}), experiment({ number: 2, slug: 'quiet', path: '/experiments/quiet', listed: false, status: 'closed', statusLabel: 'Closed', price: null, payUrl: null })]);

  it('carries a canonical on every indexable page and noindex on the rest, never both', () => {
    for (const path of [...PUBLIC_PATHS, '/experiments/brief', '/experiments/quiet']) {
      const html = pages.get(path)!;
      expect(html, path).toBeDefined();
      if (UNINDEXED.has(path)) {
        expect(html, path).toContain('<meta name="robots" content="noindex">');
        expect(html, path).not.toContain('rel="canonical"');
      } else {
        expect(html, path).toContain(`<link rel="canonical" href="https://apexmicro.ai${path}">`);
        expect(html, path).not.toContain('noindex');
      }
    }
  });

  it('announces exactly the indexable pages and the listed experiments', () => {
    const sitemap = pages.get('/sitemap.xml')!;
    expect(sitemap).toBe(renderSitemap(F, [experiment({}), experiment({ slug: 'quiet', path: '/experiments/quiet', listed: false })]));
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([...PUBLIC_PATHS.filter((p) => !UNINDEXED.has(p)), '/experiments/brief'].map((p) => `https://apexmicro.ai${p}`));
    expect(sitemap).not.toContain('/experiments/quiet');
    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('robots allows the Workshop, keeps the receipts out, and names the sitemap', () => {
    const robots = pages.get('/robots.txt')!;
    expect(robots).toBe(renderRobots(F));
    expect(robots).toContain('User-agent: *\nAllow: /\n');
    expect(robots).toContain('Disallow: /email\n');
    expect(robots).toContain('Disallow: /thank-you\n');
    expect(robots).toContain('Sitemap: https://apexmicro.ai/sitemap.xml\n');
    expect(PUBLIC_FILES).toEqual(['/robots.txt', '/sitemap.xml']);
  });

  it('says what is for sale in the form an index reads, only while it is for sale', () => {
    const forSale = pages.get('/experiments/brief')!;
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(forSale);
    expect(m).not.toBeNull();
    const ld = JSON.parse(m![1]!) as Record<string, unknown>;
    expect(ld).toMatchObject({ '@type': 'Product', name: 'A brief', brand: { name: 'Apex Micro' }, offers: { '@type': 'Offer', price: '29.00', priceCurrency: 'USD', url: 'https://apexmicro.ai/experiments/brief' } });
    expect(pages.get('/experiments/quiet')!).not.toContain('application/ld+json');
    // Nothing on the page names the person behind the trading name.
    expect(forSale).not.toContain('Somebody');
  });

  it('closes the script element only where the page does: a title that tries to is escaped', () => {
    const html = renderSite(F, [experiment({ title: 'A brief </script><script>alert(1)</script>' })]).get('/experiments/brief')!;
    const scripts = html.match(/<\/script>/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(html).toContain('<\\/script>');
  });
});

describe('the program serves the two files as what they are and refuses every other dot', () => {
  it('robots.txt as text, sitemap.xml as xml, pages as html, anything else with a dot as 404', async () => {
    const dataUrl = `data:text/javascript;base64,${Buffer.from(WORKER_SOURCE).toString('base64')}`;
    const mod = (await import(dataUrl)) as { default: { fetch: (r: Request, env: unknown) => Promise<Response> } };
    const kv = new Map<string, string>([['page:/', '<html>home</html>'], ['page:/robots.txt', 'User-agent: *'], ['page:/sitemap.xml', '<urlset/>'], ['page:/404', '<html>nope</html>'], ['page:/x.txt', 'never served']]);
    const env = { PAGES: { get: async (k: string) => kv.get(k) ?? null, put: async () => undefined } };
    const get = (p: string) => mod.default.fetch(new Request(`https://apexmicro.ai${p}`), env);
    const robots = await get('/robots.txt');
    expect(robots.status).toBe(200);
    expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await robots.text()).toBe('User-agent: *');
    const sitemap = await get('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(sitemap.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await get('/')).headers.get('content-type')).toBe('text/html; charset=utf-8');
    for (const p of ['/x.txt', '/Robots.txt', '/robots.txt.bak', '/sitemap.xml/../foundry', '/.env']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.headers.get('content-type'), p).toBe('text/html; charset=utf-8');
    }
  });
});

describe('the row guard admits exactly the two files', () => {
  it('records robots.txt and sitemap.xml as pages and refuses any other extension', async () => {
    await query("INSERT INTO founders (id, clerk_user_id, email, name) VALUES ('f_found', 'c_found', 'found@example.com', 'F')");
    const insert = (path: string) => query(
      `INSERT INTO public_publications (id, founder_id, path, kind, experiment_id, version, digest, bytes, published_by) VALUES (?, 'f_found', ?, 'page', NULL, 1, 'd', 10, 'test')`,
      [`pub_${path.replace(/[^a-z]/g, '')}`, path]);
    await insert('/robots.txt');
    await insert('/sitemap.xml');
    for (const bad of ['/x.txt', '/robots.txt.bak', '/Sitemap.xml', '/sitemap.xml?x', '/a/../robots.txt']) {
      await expect(insert(bad), bad).rejects.toThrow(/path_invalid/);
    }
    const kept = (await query("SELECT path FROM public_publications WHERE founder_id = 'f_found' ORDER BY path")).rows.map((r) => (r as Record<string, unknown>).path);
    expect(kept).toEqual(['/robots.txt', '/sitemap.xml']);
  });
});
