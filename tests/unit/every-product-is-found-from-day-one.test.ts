// =============================================================================
// EVERY PRODUCT IS FOUND FROM DAY ONE (F2, 9 October 2026; plan C-3.2).
//
// Search takes months, so publishing starts with the first product. Every
// printable on the Workshop ships with:
//   * AN ARTICLE (/experiments/<slug>/guide): the guide its own sections make,
//     every heading and introduction the file carries, words that already
//     passed every gate the file did — nothing written fresh for the page;
//   * A FREE LEAD MAGNET (/experiments/<slug>/free): one page of the file to
//     print, free, the same page the file has;
//   * both in the sitemap and the indexed set, so IndexNow announces them;
//   * llms.txt, a plain map of the Workshop for answer engines;
//   * structured data: the Product offer (already) and an Article on the guide;
//   * the version on the product page, and — once he has a merchant-of-record
//     channel open with the product on it — the line that sends a buyer in the
//     EU or the UK there, because VAT is due from the first sale to them.
// Nothing here may say what nobody can stand behind: no rating, review, sales
// count or invented figure, read by the public-claims audit's own predicates.
// =============================================================================
import { describe, expect, it } from 'vitest';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

const S = await import('../../src/services/public-workshop/site.js');

const facts = { name: 'Apex Micro', legalOperator: 'A. Operator', origin: 'https://apexmicro.ai', tagline: 'a small digital workshop', statement: 'Small useful files.', about: 'A small workshop.', contactEmail: 'hello@apexmicro.ai', region: 'Tennessee', postalAddress: null, replyRouteProven: false } as unknown as PublicWorkshopFacts;
const guide = {
  version: 2,
  outline: [
    { heading: 'Every job, by season', lede: 'What a house asks for in spring, summer, autumn and winter.' },
    { heading: 'Filters and fluids', lede: 'The small jobs that are easy to forget until something stops.' },
  ],
  freePage: { heading: 'Every job, by season', lede: 'What a house asks for in spring, summer, autumn and winter.', html: '<ul class="check"><li>Clean the gutters</li><li>Test the smoke alarms</li></ul>' },
};
const base: PublicExperiment = {
  number: 7, slug: 'home-log', path: '/experiments/home-log', listed: true,
  title: 'The Home Maintenance Log', summary: 'A log of what your house needs and when.', who: 'Homeowners', what: 'A 9-page PDF',
  limits: 'Not a survey of your house.', sources: 'Common maintenance schedules.', selection: '', note: '', sample: null, tool: null,
  status: 'testing', statusLabel: 'Open', statusLine: 'Open now', outcome: null, whereToGetIt: null, shape: 'product_page',
  clarification: null, price: { amountCents: 900, currency: 'usd', label: '$9, one time' }, freeToRead: null, recurring: false,
  payUrl: 'https://buy.stripe.com/test_fixture', openedOn: '2026-10-09', closedOn: null, updatedOn: '2026-10-09',
  supersedes: null, successor: null, graduatedTo: null, guide, elsewhere: [],
} as unknown as PublicExperiment;

describe('the article and the lead magnet', () => {
  const pages = S.renderSite(facts, [base]);

  it('the guide carries every section the file has, links to the product, and is an Article to an index', () => {
    const g = pages.get('/experiments/home-log/guide')!;
    expect(g).toBeTruthy();
    for (const o of guide.outline) { expect(g).toContain(o.heading); expect(g).toContain(o.lede); }
    expect(g).toContain('href="/experiments/home-log"');
    expect(g).toContain('href="/experiments/home-log/free"');
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(g)![1]!.replace(/<\\\//g, '</')) as Record<string, unknown>;
    expect(ld).toMatchObject({ '@type': 'Article', headline: expect.stringContaining('The Home Maintenance Log'), datePublished: '2026-10-09' });
    expect(g).toContain('rel="canonical" href="https://apexmicro.ai/experiments/home-log/guide"');
  });

  it('the free page is one page of the file, free, and says so', () => {
    const f = pages.get('/experiments/home-log/free')!;
    expect(f).toContain('Clean the gutters');
    expect(f).toMatch(/free/i);
    expect(f).toContain('version 2');
    expect(f).toContain('href="/experiments/home-log"');
  });

  it('the product page names its version and links to both', () => {
    const p = pages.get('/experiments/home-log')!;
    expect(p).toMatch(/version 2 of the file/i);
    expect(p).toContain('href="/experiments/home-log/guide"');
    expect(p).toContain('href="/experiments/home-log/free"');
  });

  it('both are in the sitemap and the indexed set, so IndexNow announces them with the rest', async () => {
    const sm = pages.get('/sitemap.xml')!;
    expect(sm).toContain('https://apexmicro.ai/experiments/home-log/guide');
    expect(sm).toContain('https://apexmicro.ai/experiments/home-log/free');
    const indexed = S.indexedPaths([base]);
    expect(indexed.has('/experiments/home-log/guide')).toBe(true);
    const { pathsToAnnounce } = await import('../../src/services/public-workshop/indexnow.js');
    expect(pathsToAnnounce({ published: ['/experiments/home-log/guide', '/experiments/home-log/free'], unverified: [], indexed }).sort()).toEqual(['/experiments/home-log/free', '/experiments/home-log/guide']);
  });

  it('llms.txt maps the Workshop: what it is, each product with its price, version and guide', () => {
    const l = pages.get('/llms.txt')!;
    expect(l).toMatch(/^# Apex Micro/);
    expect(l).toContain('[The Home Maintenance Log](https://apexmicro.ai/experiments/home-log)');
    expect(l).toContain('$9');
    expect(l).toContain('version 2');
    expect(l).toContain('https://apexmicro.ai/experiments/home-log/guide');
    expect(S.PUBLIC_FILES).toContain('/llms.txt');
  });

  it('a closed or portfolio product ships no guide, no free page and no llms entry for sale', () => {
    const closed = S.renderSite(facts, [{ ...base, status: 'closed', payUrl: null } as PublicExperiment]);
    expect(closed.has('/experiments/home-log/guide')).toBe(false);
    expect(closed.has('/experiments/home-log/free')).toBe(false);
    expect(closed.get('/llms.txt')!).not.toContain('$9');
    const entry = S.renderSite(facts, [{ ...base, shape: 'portfolio_entry', guide: null } as unknown as PublicExperiment]);
    expect(entry.has('/experiments/home-log/guide')).toBe(false);
  });
});

describe('a buyer in the EU or the UK is sent to a merchant of record, once there is one', () => {
  it('no merchant-of-record channel: no line (the Workshop page is the live path)', () => {
    expect(S.renderSite(facts, [base]).get('/experiments/home-log')!).not.toMatch(/EU or the UK/);
  });
  it('a channel that is NOT a merchant of record (Etsy here) does not take the EU buyer: no line, and the rule keeps the Workshop', async () => {
    const etsyOnly = { ...base, elsewhere: [{ channel: 'etsy', venueName: 'Etsy', url: 'https://www.etsy.com/listing/1', merchantOfRecord: false }] } as unknown as PublicExperiment;
    expect(S.renderSite(facts, [etsyOnly]).get('/experiments/home-log')!).not.toMatch(/EU or the UK/);
    const { routeBuyer } = await import('../../src/services/venture/storefront/tax.js');
    expect(routeBuyer('FR', [{ channel: 'etsy', url: 'https://www.etsy.com/listing/1', merchantOfRecord: false }])).toMatchObject({ to: 'workshop' });
  });
  it('with Gumroad carrying it: the line, naming that it charges and pays the VAT', () => {
    const withMor = { ...base, elsewhere: [{ channel: 'gumroad', venueName: 'Gumroad', url: 'https://example.gumroad.com/l/home-log', merchantOfRecord: true }] } as unknown as PublicExperiment;
    const p = S.renderSite(facts, [withMor]).get('/experiments/home-log')!;
    expect(p).toMatch(/Buying from the EU or the UK\?/);
    expect(p).toContain('href="https://example.gumroad.com/l/home-log"');
    expect(p).toMatch(/charges and pays the VAT/);
  });
  it('the routing rule itself: EU and UK countries go to a merchant of record when one carries it, others stay', async () => {
    const { routeBuyer } = await import('../../src/services/venture/storefront/tax.js');
    const mor = [{ channel: 'gumroad' as const, url: 'https://x', merchantOfRecord: true }];
    expect(routeBuyer('DE', mor)).toMatchObject({ to: 'gumroad' });
    expect(routeBuyer('GB', mor)).toMatchObject({ to: 'gumroad' });
    expect(routeBuyer('US', mor)).toMatchObject({ to: 'workshop' });
    expect(routeBuyer('DE', [])).toMatchObject({ to: 'workshop', because: expect.stringMatching(/no merchant of record/) });
  });
});

describe('no claim the public-claims audit would reject', () => {
  it('no rating, review, sales count or invented figure on any page it adds', async () => {
    const { fabricationScan } = await import('../../src/services/venture/products/printable.js');
    const { BANNED_CLAIMS } = await import('../../src/services/venture/hand.js');
    const { SALES_COUNT } = await import('../../src/services/venture/products/offer-composition.js');
    const pages = S.renderSite(facts, [base]);
    for (const path of ['/experiments/home-log/guide', '/experiments/home-log/free', '/llms.txt']) {
      // The words a reader sees: style and script blocks are not claims.
      const text = pages.get(path)!.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(BANNED_CLAIMS.filter((b) => text.toLowerCase().includes(b)), path).toEqual([]);
      expect(fabricationScan(text).filter((x) => !x.startsWith('a claim the Workshop')), path).toEqual([]);
      expect(SALES_COUNT.exec(text), path).toBeNull();
      expect(text, path).not.toMatch(/aggregateRating|reviewCount|★/);
    }
  });
});
