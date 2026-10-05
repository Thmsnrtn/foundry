// =============================================================================
// LAW (Roadmap 2027 R38): SEARCH ENGINES ARE TOLD WHEN A WORKSHOP PAGE CHANGES,
// AND THE SITEMAP SAYS WHEN.
//
// A page on a new domain waits on a crawler's schedule, and a 30-day window
// can close before it is indexed. IndexNow takes the changed addresses from
// the site's owner, proved by a key file the site serves. Only pages meant to
// be indexed are announced, only versions put up and read back this pass, and
// only through the door that publishes them. The sitemap carries each
// experiment page's own last-changed date and no invented one.
// (The end-to-end announcement is asserted in the-workshop-has-one-public-face.)
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = 'n'.repeat(64);

import { describe, expect, it } from 'vitest';
import { announcementFor, announcementKey, INDEXNOW_KEY, INDEXNOW_KEY_PATH, pathsToAnnounce } from '../../src/services/public-workshop/indexnow.js';
import { indexedPaths, renderSitemap } from '../../src/services/public-workshop/site.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

const F: PublicWorkshopFacts = {
  name: 'Apex Micro', legalOperator: 'Somebody', origin: 'https://apexmicro.ai', tagline: 't', statement: 's', about: 'a',
  contactEmail: 'hello@apexmicro.ai', postalAddress: null, region: 'Massachusetts',
};
const x = (over: Partial<PublicExperiment>): PublicExperiment => ({
  number: 1, slug: 'bid-check', path: '/experiments/bid-check', listed: true, title: 'Bid check', summary: 's', who: 'w', what: 'x', limits: 'l',
  sources: 'o', selection: 'n', note: '', sample: null, status: 'testing', statusLabel: 'Pilot', statusLine: 'Open now.', outcome: null,
  whereToGetIt: null, shape: 'product_page', clarification: null, price: null, recurring: false, payUrl: null, tool: null,
  openedOn: '2026-10-01', closedOn: null, updatedOn: '2026-10-04', supersedes: null, successor: null, graduatedTo: null, ...over,
} as PublicExperiment);

describe('what is announced', () => {
  const indexed = indexedPaths([x({}), x({ slug: 'hidden', path: '/experiments/hidden', listed: false })]);

  it('only pages meant to be indexed, put up this pass, and read back', () => {
    const published = ['/', '/privacy', '/experiments/bid-check', '/experiments/hidden', '/email', '/404', '/robots.txt', '/sitemap.xml', '/thank-you'];
    expect(pathsToAnnounce({ published, unverified: ['/privacy: mismatch'], indexed }))
      .toEqual(['/', '/experiments/bid-check']);
  });

  it('nothing changed means nothing to announce', () => {
    expect(pathsToAnnounce({ published: [], unverified: [], indexed })).toEqual([]);
  });

  it('the body names the Workshop\'s own host, its public key file, and only its own addresses; the same list dedupes', () => {
    const b = announcementFor('https://apexmicro.ai', ['/', '/experiments/bid-check']);
    expect(b).toEqual({ host: 'apexmicro.ai', key: INDEXNOW_KEY, keyLocation: `https://apexmicro.ai${INDEXNOW_KEY_PATH}`,
      urlList: ['https://apexmicro.ai/', 'https://apexmicro.ai/experiments/bid-check'] });
    const v = (n: number) => b.urlList.map((u) => `${u}@v${String(n)}`);
    expect(announcementKey('f', v(2))).toBe(announcementKey('f', [...v(2)]));
    expect(announcementKey('f', v(2))).not.toBe(announcementKey('f', v(2).slice(1)));
  });

  it('the same pages changing again later are announced again: the key names the versions, not only the addresses', () => {
    const urls = ['https://apexmicro.ai/experiments/bid-check'];
    expect(announcementKey('f', urls.map((u) => `${u}@v3`))).not.toBe(announcementKey('f', urls.map((u) => `${u}@v7`)));
  });
});

describe('the key file is served by the program itself', () => {
  it('is a valid IndexNow key, named in the program\'s files, and answered with itself', () => {
    expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
    expect(WORKER_SOURCE).toContain(`${JSON.stringify(INDEXNOW_KEY_PATH)}: 'text/plain; charset=utf-8'`);
    expect(WORKER_SOURCE).toContain('if (path === INDEXNOW_KEY_PATH) return new Response(INDEXNOW_KEY');
  });

  it('the handler only ever posts to the protocol\'s endpoint, for the Workshop\'s own host read from its row, never from the request', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/integration/cloudflare-gateway.ts', 'utf8');
    const handler = /async function indexNowSubmitHandler[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    expect(handler).toContain("fetch('https://api.indexnow.org/indexnow'");
    expect(handler).toContain("SELECT origin FROM public_workshop WHERE product_id = ?");
    expect(handler).toContain("throw new CloudflareRefused('path_invalid')");
    expect(handler).not.toMatch(/p\.host|params\.host|p\.urlList/);
  });
});

describe('a page that returns to an earlier text is put up again', () => {
  // A dated sitemap goes back and forth as an experiment page changes; the
  // store's write was deduplicated on the text alone, so a return to an earlier
  // text was never written and the edge kept serving the newer one, while the
  // record said the earlier one was live. The idempotency key names the version.
  it('the page store write is keyed on the version as well as the text', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/public-workshop/publication.ts', 'utf8');
    expect(src).toContain('dedupKey: `public:${input.founderId}:${input.path}:v${String(version)}:${digest}`');
    expect(src).not.toContain('dedupKey: `public:${input.founderId}:${input.path}:${digest}`');
  });
});

describe('the sitemap says when', () => {
  it('an experiment page carries its own last-changed date; fixed pages carry none; an unlisted page is absent', () => {
    const xml = renderSitemap(F, [x({}), x({ slug: 'hidden', path: '/experiments/hidden', listed: false })]);
    expect(xml).toContain('<loc>https://apexmicro.ai/experiments/bid-check</loc><lastmod>2026-10-04</lastmod>');
    expect(xml).toContain('<loc>https://apexmicro.ai/about</loc></url>');
    expect(xml).not.toContain('/experiments/hidden');
  });
});
