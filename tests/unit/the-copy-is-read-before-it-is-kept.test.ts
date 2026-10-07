// =============================================================================
// LAW (Roadmap 2027 R29c): WHAT THE MODEL WROTE IS READ BEFORE IT IS KEPT.
//
// The offer text and the deliverable were held to the banned claims ("never
// miss", "guaranteed", "trusted by"...) and the page copy the model wrote for
// the Workshop was not, though a stranger reads the page first; and the
// sentence that says how the offer charges was never read against the plan.
// Now a composition whose copy makes a banned claim, or whose charging sentence
// describes a repeating charge a one-time plan does not make (or a weekly plan
// without saying weekly), is refused before anything is made or stored.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '3'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';

let reply: Record<string, unknown> = {};
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async () => ({ content: JSON.stringify(reply), tokensUsed: 10, costUsd: 0 })),
}));
const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

const OWNER = 'copy_owner';
const X = 'copy_x1';
const good = {
  title: 'Bid roles brief', terms: 'contractor bid tracker', source_types: ['directory', 'community'],
  coverage: 'It covers what two public sources showed on the pull date, and nothing else.',
  price_dollars: 19, price_because: 'a short read', product_name: 'Bid Roles Brief',
  sells: 'a dated shortlist of public postings', claims_made: 'a shortlist, not a complete listing; refund on request',
  collects: 'the buyer\'s email for one delivery', delivers_by: 'email, when the payment settles',
  sells_to: 'Small contractors.', charges_how: 'one-time, $19, no subscription', lighter: 'a shortlist of public rows',
  offer_subject: 'A short brief',
  page: { summary: 'A dated shortlist.', who: 'Small contractors.', what: 'One brief by email.', limits: 'A shortlist, not the market.',
    sources: 'Two public sources.', note: 'A small pilot. If it is no use to you, you get your money back.' },
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_copy', 'owner@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('copy_ws','Apex Micro',?,'active','real')", [OWNER]);
  await query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`, [OWNER, 'copy_ws', 'Apex Micro', 'Owner', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('copy_opp',?,?,'a bid brief','small contractors','by hand','people said so','one firm','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('copy_unk',?,'copy_opp','would they pay',1,'offer one')`, [OWNER]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'copy_opp','copy_unk','offer one','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  const { recordDesign } = await import('../../src/services/venture/probe-design.js');
  await recordDesign({
    founderId: OWNER, experimentId: X, decides: 'whether one pays', decidesBecause: 'money settles it',
    exchange: 'upfront_price', exchangeBecause: 'the one exchange', canProve: 'one pays', cannotProve: 'twice',
    ratherThanWaiting: 'reading will not settle it', distribution: 'the page', ifItSucceeds: 'more',
    recommendation: 'run', recommendationBecause: 'cheap', designedBy: 'test',
    interpretations: [{ observation: 'nobody pays', reading: 'no' }, { observation: 'nobody pays', reading: 'unseen' }],
    costs: [{ dimension: 'cash', level: 'low', grounds: 'x' }, { dimension: 'reputation', level: 'low', grounds: 'y' }, { dimension: 'participant_burden', level: 'none', grounds: 'z' }],
    stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a' }, { kind: 'opt_outs', threshold: 3, because: 'b' }],
  });
});

const made = async () => (await import('../../src/services/venture/products/offer-composition.js')).shapeAndMake(X);
const materials = async () => Number(((await query('SELECT COUNT(*) AS n FROM experiment_materials WHERE experiment_id = ?', [X])).rows[0] as Record<string, unknown>).n);

describe('the page copy is held to the same claims as the offer', () => {
  it('a page note that guarantees something is refused, and nothing is made', async () => {
    reply = { ...good, page: { ...good.page, note: 'Guaranteed to save you hours every week.' } };
    const r = await made();
    expect('refused' in r ? r.refused : '').toMatch(/a claim the Workshop does not make: "save you hours", "guarantee", "guaranteed"|a claim the Workshop does not make/);
    expect(await materials()).toBe(0);
  });
  it('a summary that says "trusted by" is refused too', async () => {
    reply = { ...good, page: { ...good.page, summary: 'Trusted by contractors across the state.' } };
    const r = await made();
    expect('refused' in r ? r.refused : '').toMatch(/"trusted by"/);
  });
});

describe('what a stranger reads is held to what the file is held to (the twin\'s adversarial world)', () => {
  // Read only for the banned phrases, the page could carry a sales count, an
  // invented statistic, a quoted buyer, or a struck-through price nobody was
  // ever charged. Each is refused before anything is made, quoted.
  for (const [what, summary, says] of [
    ['a sales count nobody recorded', 'A dated shortlist. Over 2,400 contractors already use it (k1).', /a sales count nobody recorded: ".*Over 2,400 contractors already use it \(k1\)/],
    ['a struck-through price', 'A dated shortlist. Was $79, today only $19 (k2).', /a price other than the price it charges \(\$19\): ".*Was \$79.*k2/],
    ['an invented statistic', 'A dated shortlist. 87% of contractors miss a bid each year (k3).', /a statistic: ".*87%.*k3/],
    ['a quoted buyer', 'A dated shortlist. "This changed everything for my firm" — Dana R. (k4)', /a testimonial: ".*Dana R.*k4/],
  ] as const) {
    it(`${what} on the page is refused, quoted, and nothing is made`, async () => {
      reply = { ...good, page: { ...good.page, summary } };
      const r = await made();
      expect('refused' in r ? r.refused : '').toMatch(says);
      expect(await materials()).toBe(0);
    });
  }
  it('the price it charges, said on the page, is not refused', async () => {
    reply = { ...good, page: { ...good.page, summary: 'A dated shortlist, $19 once.' } };
    const r = await made();
    expect('refused' in r ? r.refused : 'made').not.toMatch(/a price other than/);
  });
});

describe('the sentence on how it charges matches the plan', () => {
  it('a one-time plan whose sentence describes a weekly charge is refused', async () => {
    reply = { ...good, charges_how: 'charged every week until you cancel' };
    const r = await made();
    expect('refused' in r ? r.refused : '').toMatch(/describes a repeating charge the plan does not make/);
    expect(await materials()).toBe(0);
  });
  it('"no subscription" is not mistaken for a subscription', async () => {
    reply = { ...good };
    const r = await made();
    expect('refused' in r ? r.refused : 'made').not.toMatch(/repeating charge|claim the Workshop/);
  });
});
