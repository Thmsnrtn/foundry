process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);

import { describe, expect, it } from 'vitest';
import { canBuy, renderSite } from '../../src/services/public-workshop/site.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

// =============================================================================
// THE FRONT PAGE IS A SHOP, NOT A FILING CABINET.
//
// The owner: available products should not be presented primarily as numbered
// experiments, and a visitor should not have to browse an experiment history to
// find out what he sells. The site was already most of the way there — the nav
// says "What I've put out", a record page is headed by the product's own name —
// and two things stood in the way.
//
// "What's here now" filtered on `listed` alone, so a CLOSED record sat under
// that heading beside something somebody could buy. A front page saying "now"
// about a record is the same class of untruth this campaign has been correcting
// everywhere else: a sentence the rows do not support.
//
// And every card carried "No. 003", which frames a product as the third of a
// series of experiments. That is the workshop's own filing. It belongs on
// `/experiments`, where the lede promises these are listed "in the order I made
// it" and the number is what makes that sentence true.
//
// NOTHING IS REMOVED. Every promise the site makes about history — every page
// stays up, closed ones keep a note of why, graduated ones point onward — is
// still literally true, and these tests hold it that way.
// =============================================================================

const F: PublicWorkshopFacts = {
  name: 'Apex Micro', legalOperator: 'Somebody', origin: 'https://apexmicro.ai',
  tagline: 'a small digital workshop in Massachusetts',
  statement: 'Apex Micro makes small things.', about: 'About.',
  contactEmail: 'hello@apexmicro.ai', postalAddress: null, region: 'Massachusetts',
};

const x = (over: Partial<PublicExperiment>): PublicExperiment => ({
  number: 1, slug: 'brief', path: '/experiments/brief', listed: true,
  title: 'A brief', summary: 'What it is.', who: 'Who.', what: 'What.', limits: 'Limits.',
  sources: 'Sources.', selection: 'Selection.', note: '', sample: null,
  status: 'testing', statusLabel: 'Pilot', statusLine: 'Open now.', outcome: null,
  whereToGetIt: null, shape: 'product_page', clarification: null,
  price: { amountCents: 2900, currency: 'usd', label: '$29, one time' }, recurring: false,
  payUrl: 'https://buy.stripe.com/x',
  openedOn: '2026-09-01', closedOn: null, updatedOn: '2026-09-01',
  supersedes: null, successor: null, graduatedTo: null,
  ...over,
} as PublicExperiment);

/** Bought here, open. */
const OPEN = x({});
/** Sold on a venue: open, and the way to get it is the listing. */
const ON_A_VENUE = x({
  number: 2, slug: 'workbook', path: '/experiments/workbook', title: 'A workbook',
  shape: 'portfolio_entry', price: null, payUrl: null,
  whereToGetIt: { url: 'https://www.etsy.com/listing/1/workbook', venueName: 'Etsy' },
});
/** Ended. Its page stays; it is not "here now". */
const CLOSED = x({
  number: 3, slug: 'gone', path: '/experiments/gone', title: 'A closed thing',
  status: 'closed', statusLabel: 'Closed', statusLine: 'It ended.', outcome: 'Nobody bought it.',
  price: null, payUrl: null, closedOn: '2026-09-10',
});
/** Open in status, but the offer came down — there is nowhere to send anybody. */
const NO_WAY_IN = x({
  number: 4, slug: 'dark', path: '/experiments/dark', title: 'A dark thing',
  status: 'operating', statusLabel: 'Open', price: null, payUrl: null, whereToGetIt: null,
});

const ALL = [OPEN, ON_A_VENUE, CLOSED, NO_WAY_IN];

describe('what a customer can actually get today', () => {
  it('is a live status AND somewhere to buy it, never a status alone', () => {
    expect(canBuy(OPEN)).toBe(true);
    expect(canBuy(ON_A_VENUE)).toBe(true);
    expect(canBuy(CLOSED)).toBe(false);
    // THE CASE A STATUS ALONE GETS WRONG. "Open" with the offer down is a test
    // that ended well, not a product on sale, and a front page that listed it
    // would be pointing at a door that is shut.
    expect(canBuy(NO_WAY_IN)).toBe(false);
  });
});

describe('the front page', () => {
  const home = renderSite(F, ALL).get('/')!;

  it('lists what is available and nothing that ended', () => {
    expect(home).toContain('A brief');
    expect(home).toContain('A workbook');
    expect(home).not.toContain('A closed thing');
    expect(home).not.toContain('A dark thing');
  });

  it('does not frame a product as a numbered experiment', () => {
    expect(home).not.toMatch(/No\. \d{3}/);
  });

  it('says how much else there is, and links to it rather than hiding it', () => {
    expect(home).toContain("2 other things I've put out");
    expect(home).toContain('href="/experiments"');
  });

  it('says plainly when nothing is open, rather than listing history instead', () => {
    const quiet = renderSite(F, [CLOSED]).get('/')!;
    expect(quiet).toContain("Nothing's open at the moment.");
    expect(quiet).not.toContain('A closed thing');
    // And the record is still one line away.
    expect(quiet).toContain("One other thing I've put out");
  });
});

describe('the record is intact, which is the other half of the promise', () => {
  const pages = renderSite(F, ALL);

  it('keeps every page up, including the ones the front page no longer shows', () => {
    for (const r of ALL) expect(pages.get(r.path), r.path).toBeDefined();
    expect(pages.get('/experiments/gone')).toContain('A closed thing');
  });

  it('keeps the registry, its promise and its ordering', () => {
    const registry = pages.get('/experiments')!;
    expect(registry).toContain('Every page stays up, whatever happened to it.');
    expect(registry).toContain('in the order I made it');
    for (const r of ALL) expect(registry, r.title).toContain(r.title);
  });

  it('keeps the number where the ordering claim needs it', () => {
    const registry = pages.get('/experiments')!;
    expect(registry).toContain('No. 001');
    expect(registry).toContain('No. 003');
  });

  it('keeps the closed, graduated and operating shelves answering', () => {
    for (const p of ['/closed', '/graduated', '/operating']) expect(pages.get(p), p).toBeDefined();
    expect(pages.get('/closed')).toContain('A closed thing');
  });
});

describe('the last corners that still said "experiments" to a customer', () => {
  const pages = renderSite(F, ALL);

  it('calls the registry what the nav calls it, on the not-found page', () => {
    const missing = pages.get('/404')!;
    expect(missing).toContain("What I've put out");
    expect(missing).not.toMatch(/>Experiments</);
  });

  it('does not describe the terms as terms for experiments', () => {
    expect(pages.get('/terms')).not.toContain('Terms for experiments');
  });
});
