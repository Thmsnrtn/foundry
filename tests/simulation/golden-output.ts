// =============================================================================
// FOUNDRY — Golden Output Harness (the taste check)
//
// Prints what the owner actually reads, on the world production has, so a
// person can judge it: Home's one thing, what needs the owner and why, whether
// Foundry can sell on its own, what an absence would mean, the test the owner is
// being asked about, and the money. No model call, no network, no live key.
//
// REBUILT ON THE PRODUCTION WORLD (remediation 3, 6 October 2026). It seeded a
// SaaS founder with MRR, churn, customers, autopilot policies and a Letter —
// a company shape this private instance does not have and pages the owner no
// longer reads — so its output could be sharp and still say nothing about the
// product. It now reads the owner's own screens off `seedProductionShape`, as
// the walk and the crawl do, and it FAILS (exit 1) on a page that is not 200
// or that carries a template artifact, so it cannot quietly print an error.
//
// Run: npm run sim:golden
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.STRIPE_SECRET_KEY ??= 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_fake';

const { providerStubs } = await import('../helpers/provider-stubs.js');
const stubs = providerStubs();
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  return stubs.fetch(u, init);
}) as typeof fetch;

const { seedProductionShape, addCompanies, ownerApp, OWNER } = await import('../helpers/world.js');
const { withViewer } = await import('../../src/views/owner/viewer.js');

const rule = (t: string): void => console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);

/** The words of a page's main, as a reader meets them: tags gone, closed
 *  disclosures included (a printed page has no fold), whitespace collapsed. */
function words(html: string, selector: 'main' | 'one' = 'main'): string {
  const scope = selector === 'one'
    ? (/<section[^>]*id="the-one-thing"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '')
    : (/<main[\s\S]*?<\/main>/.exec(html)?.[0] ?? html);
  return scope
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, (f) => (/class="ask"/.test(f) ? '' : f))
    .replace(/<\/(p|li|h[1-6]|dt|dd|summary|section|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

const ARTIFACTS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/];
const failures: string[] = [];

async function main(): Promise<void> {
  const { experimentId } = await seedProductionShape({ charter: true, searching: true, eyes: true, undecided: true });
  const app = await ownerApp();
  await addCompanies(app, ['Apex Micro Press', 'Northfield Candles', 'Tidewater Templates']);
  const read = async (path: string): Promise<string> => {
    const res = await withViewer(OWNER, async () => app.request(path, { headers: { accept: 'text/html' } }));
    const html = await res.text();
    if (res.status !== 200) failures.push(`${path} answered ${String(res.status)}`);
    for (const rx of ARTIFACTS) if (rx.test(words(html))) failures.push(`${path} carries "${rx.source}"`);
    return html;
  };

  const home = await read('/foundry');
  rule('HOME — the one thing, as the card says it');
  console.log(words(home, 'one') || '(no card: nothing needs the owner)');

  rule('NEEDS YOU — everything waiting on the owner, and why');
  console.log(words(await read('/foundry/needs-you')));

  rule('CONTROL — can Foundry sell on its own today, and what stops it');
  const control = words(await read('/foundry/controls'));
  console.log(control.split('\n').slice(0, 30).join('\n'));

  rule('IF YOU STEPPED AWAY — the week');
  const away = words(await read('/foundry/absence'));
  console.log(away.split('\n').slice(0, 30).join('\n'));

  rule('THE TEST THE OWNER IS BEING ASKED ABOUT');
  console.log(words(await read(`/foundry/experiments/${experimentId}`)).split('\n').slice(0, 40).join('\n'));

  rule('ECONOMICS');
  console.log(words(await read('/foundry/money')).split('\n').slice(0, 25).join('\n'));

  console.log(`\n${'─'.repeat(70)}`);
  console.log('  Read the above as the owner would, on a phone between other things.');
  console.log('  Is each sentence true, specific and the owner's — or generic, or about Foundry?');
  console.log(`${'─'.repeat(70)}\n`);

  if (failures.length) {
    console.error(`golden: ${String(failures.length)} page(s) could not be read cleanly:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
