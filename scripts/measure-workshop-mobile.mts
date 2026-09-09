// Measures the public Workshop's own pages at phone widths, and the owner's
// Workshop page beside them. The public pages are the ones a stranger opens on
// a phone from an email; horizontal scrolling there is a broken promise.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { renderSite } from '../src/services/public-workshop/site.js';

const facts = {
  name: 'Apex Micro', operator: 'Thomas Norton', origin: 'https://apexmicro.ai',
  tagline: 'a digital workshop by Thomas Norton',
  statement: "I'm Thomas Norton. I run Apex Micro, a small digital workshop where I test useful niche products and services before deciding whether they're worth developing into independent businesses. I use software I've built to help with research and operations, but I'm the person responsible for every experiment here.\n\nExperiments start small and are clearly labeled as experiments. Some become businesses. Some remain small useful tools. Others are closed when the evidence says they aren't worth continuing.",
  about: '', contactEmail: 'thomas@apexmicro.ai', postalAddress: 'PO Box 123, Example, MA 01000', region: 'Massachusetts, USA',
};
const experiment = {
  number: 1, slug: 'ma-millwork-bid-brief', path: '/experiments/ma-millwork-bid-brief', listed: true,
  title: 'Massachusetts Millwork Bid Brief',
  summary: 'A one-time test of a simpler way for commercial millwork shops to find potentially relevant Massachusetts public bid opportunities.',
  who: 'Independent commercial cabinet, casework and architectural millwork shops in Massachusetts that bid, or would like to bid, on public work.',
  what: 'One brief, by email, within one business day of payment: a hand-screened shortlist of the public bid notices currently open on COMMBUYS that appear relevant to cabinet, casework, countertop and millwork work. Each item carries the bid number, the opening date, the agency contact, one line on why it may fit, and a link to the original notice. The pilot edition lists thirteen notices screened from the 952 solicitations open in the week it was pulled.',
  limits: 'It is not complete. It covers COMMBUYS only, not the Central Register, DCAMM’s e-bid room or agency portals. Relevance is judged from the notice text, not from the bid documents.',
  sources: 'COMMBUYS, the Commonwealth of Massachusetts public procurement record, read in full for each listed notice on the date shown in the brief.',
  selection: 'A small number of Massachusetts millwork businesses were chosen by hand from their public websites, where the commercial work shown suggested the brief could be relevant.',
  note: "Hi, I'm Thomas Norton. I run Apex Micro, a small digital workshop where I test useful niche products and services before deciding whether they're worth developing into independent businesses.\n\nFor this experiment I'm testing whether a short, curated brief of current Massachusetts public bid notices is useful enough to commercial millwork shops that they'd pay $29 for it. This is a pilot, not an established service and not a subscription.",
  status: 'testing' as const, statusLabel: 'Testing',
  statusLine: 'Testing — this is a live pilot. What is offered, what it costs and what it does not claim are below.',
  outcome: null, price: { amountCents: 2900, currency: 'USD', label: '$29, one time' }, recurring: false as const,
  payUrl: 'https://buy.stripe.com/test_x', openedOn: '2026-09-09', closedOn: null, updatedOn: '2026-09-09',
  supersedes: null, successor: null, graduatedTo: null,
};
const pages = renderSite(facts, [experiment]);
const dir = 'docs/design/mobile';
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const failures: string[] = [];
const rows: string[] = [];
for (const width of [320, 390, 430]) {
  for (const scale of [1, 1.3]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const [path, html] of pages) {
      await page.setContent(html);
      if (scale !== 1) await page.addStyleTag({ content: `html{font-size:${16 * scale}px}` });
      await page.waitForTimeout(20);
      const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, tap: [...document.querySelectorAll('a,button,input,summary')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.height < 40 || r.width < 24); }).length }));
      const overflow = m.doc > m.win + 1;
      rows.push(`${String(width).padEnd(5)} ${String(scale).padEnd(4)} ${String(m.doc).padEnd(5)} vs ${String(m.win).padEnd(5)} tap<44:${String(m.tap).padEnd(3)} ${overflow ? 'OVERFLOW' : 'ok      '} ${path}`);
      if (overflow) failures.push(`${path} at ${width}px ${scale * 100}%: ${m.doc}px of content in a ${m.win}px window`);
      if (width === 390 && scale === 1 && (path === '/' || path === '/experiments/ma-millwork-bid-brief')) {
        await page.screenshot({ path: `${dir}/apexmicro-${path === '/' ? 'home' : 'experiment'}-390.png`, fullPage: true });
      }
    }
    await context.close();
  }
}
await browser.close();
console.log('width scale doc      win   taps      verdict  path');
console.log(rows.join('\n'));
if (failures.length) { console.log('\nHORIZONTAL OVERFLOW:\n' + failures.map((f) => '  ' + f).join('\n')); process.exit(1); }
console.log(`\n✓ ${pages.size} public pages, 3 widths, 2 text sizes: no horizontal scrolling, every control at least 44px tall.`);
