// =============================================================================
// LAW (Roadmap 2027 R22): THE PRIVACY PAGE SAYS WHAT THE PAGES DO.
//
// A public promise in the owner's voice must be true. R15 put a script on the
// public site: a free tool's page carries /tool.js, the calculator runtime. The
// privacy page still said "no scripts". It was true until the first tool page
// went up, and false from then on, on a page whose whole job is to be believed.
//
// So the privacy page is rendered from the same registry as the pages it
// describes. Where any page loads /tool.js, it says there is a calculator, says
// what it does, and never says "no scripts". The parts of the promise that stay
// true stay said: no cookies, no analytics, no tracking pixels. And the reason
// the calculator sentence is true is pinned too: the Worker's security policy
// lets the page run only its own script and connect nowhere, and the script
// itself contains no way to send anything.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '6'.repeat(64);

import { describe, expect, it } from 'vitest';
import { renderSite } from '../../src/services/public-workshop/site.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';
import { TOOL_RUNTIME_JS, type ToolSpec } from '../../src/services/venture/products/tool.js';
import type { PublicExperiment, PublicWorkshopFacts } from '../../src/services/public-workshop/projection.js';

const F: PublicWorkshopFacts = {
  name: 'Apex Micro', legalOperator: 'Somebody', origin: 'https://apexmicro.ai',
  tagline: 'a small digital workshop in Massachusetts',
  statement: 'Apex Micro makes small things.', about: 'About.',
  contactEmail: 'hello@apexmicro.ai', postalAddress: null, region: 'Massachusetts',
};

const TOOL: ToolSpec = {
  title: 'Is this bid worth the hours?',
  explains: 'Works out what a bid is worth once you allow for what your hours cost.',
  inputs: [
    { id: 'value', label: 'Job value', unit: 'USD', min: 100, max: 1_000_000, step: 100, value: 20_000 },
    { id: 'hours', label: 'Hours to bid', unit: 'hours', min: 0.5, max: 200, step: 0.5, value: 6 },
  ],
  outputs: [{ id: 'per_hour', label: 'Value per hour', unit: 'USD', formula: 'value / hours', decimals: 0 }],
  examples: [{ inputs: { value: 20_000, hours: 6 }, outputs: { per_hour: 3333 } }],
};

const x = (over: Partial<PublicExperiment>): PublicExperiment => ({
  number: 1, slug: 'brief', path: '/experiments/brief', listed: true,
  title: 'A brief', summary: 'What it is.', who: 'Who.', what: 'What.', limits: 'Limits.',
  sources: 'Sources.', selection: 'Selection.', note: '', sample: null,
  status: 'testing', statusLabel: 'Pilot', statusLine: 'Open now.', outcome: null,
  whereToGetIt: null, shape: 'product_page', clarification: null,
  price: { amountCents: 2900, currency: 'usd', label: '$29, one time' }, recurring: false,
  payUrl: 'https://buy.stripe.com/x', tool: null,
  openedOn: '2026-09-01', closedOn: null, updatedOn: '2026-09-01',
  supersedes: null, successor: null, graduatedTo: null,
  ...over,
} as PublicExperiment);

const PAID = x({});
const WITH_TOOL = x({ number: 2, slug: 'bid-check', path: '/experiments/bid-check', title: 'Bid check', tool: TOOL });

const SITES: Array<[string, PublicExperiment[]]> = [
  ['nothing listed', []],
  ['a paid brief only', [PAID]],
  ['a free tool beside a paid brief', [PAID, WITH_TOOL]],
  ['a free tool alone', [WITH_TOOL]],
];

describe('the privacy page describes the site it sits on', () => {
  it('where a page carries the calculator, never says "no scripts" and says what the calculator does', () => {
    const pages = renderSite(F, [PAID, WITH_TOOL]);
    expect(pages.get('/experiments/bid-check')).toContain('/tool.js');
    const privacy = pages.get('/privacy')!;
    expect(privacy).not.toMatch(/no scripts/i);
    expect(privacy).toMatch(/calculator/i);
    expect(privacy).toMatch(/runs in your browser/i);
    expect(privacy).toMatch(/forbid it to send/i);
    expect(privacy).toContain('No cookies');
    expect(privacy).toContain('no tracking pixels');
    expect(privacy).toContain('no analytics');
  });

  it('where no page carries one, says nothing about a calculator, and keeps every other promise', () => {
    const privacy = renderSite(F, [PAID]).get('/privacy')!;
    expect(privacy).not.toMatch(/calculator/i);
    expect(privacy).toContain('No cookies');
    expect(privacy).toContain('no tracking pixels');
    expect(privacy).toContain('no analytics');
  });

  it.each(SITES)('%s: if any page loads /tool.js, the privacy page does not deny scripts', (_name, registry) => {
    const pages = renderSite(F, registry);
    const anyScript = [...pages.entries()].some(([path, html]) => path !== '/privacy' && html.includes('/tool.js'));
    const privacy = pages.get('/privacy')!;
    if (anyScript) expect(privacy).not.toMatch(/no scripts/i);
    expect(/calculator/i.test(privacy)).toBe(anyScript);
  });

  it('a withdrawn or venue-sold entry carries no tool, so it adds no calculator sentence', () => {
    const elsewhere = x({ number: 3, slug: 'workbook', path: '/experiments/workbook', shape: 'portfolio_entry', price: null, payUrl: null, tool: null,
      whereToGetIt: { url: 'https://www.etsy.com/listing/1/workbook', venueName: 'Etsy' } });
    expect(renderSite(F, [elsewhere]).get('/privacy')!).not.toMatch(/calculator/i);
  });
});

describe('why the calculator sentence is true', () => {
  it("the Worker's policy runs only the site's own script and lets nothing connect anywhere", () => {
    const csp = /'content-security-policy': "([^"]+)"/.exec(WORKER_SOURCE)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/connect-src/);
    expect(csp).not.toMatch(/https?:/);
  });

  it('the calculator runtime contains no way to send, store or fetch anything', () => {
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'new Image(', 'import(', 'document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'EventSource', 'postMessage']) {
      expect(TOOL_RUNTIME_JS, forbidden).not.toContain(forbidden);
    }
  });

  it('the source comment above the renderers no longer claims "no scripts"', async () => {
    const { readFileSync } = await import('fs');
    const head = readFileSync('src/services/public-workshop/site.ts', 'utf8').split('\n').slice(0, 12).join('\n');
    expect(head).not.toMatch(/no scripts/i);
  });
});
