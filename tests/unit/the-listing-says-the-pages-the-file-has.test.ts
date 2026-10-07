// =============================================================================
// LAW: THE LISTING SAYS THE PAGES THE FILE HAS.
//
// The twin's degraded brain wrote "a 30-page printable bundle" over a file of
// seven pages, and every gate let it through: the file was checked, the copy
// was checked, and nothing compared the two. The buyer panel had already said
// what that costs ("the listing says 18 fill-in pages, but the contents lists
// 20 sections … it makes me doubt the counting"). Now a page count the listing
// states is read against the file as printed, before anything is kept.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PRINTABLE_CONTENT_HONEST, PRINTABLE_OFFER } from '../fixtures/printable-home-maintenance.js';

let offer: Record<string, unknown> = PRINTABLE_OFFER as unknown as Record<string, unknown>;
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    if (system.startsWith('You shape the offer')) return say(offer);
    if (system.startsWith('You write the pages of a printable')) return say(PRINTABLE_CONTENT_HONEST);
    if (system.startsWith('You check a printable file')) return say({ invented: [], regulated_advice: false });
    return say({ verdict: 'yes', max_price_dollars: 20, why: 'I would use every page.' });
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const P = await import('../../src/services/venture/products/printable.js');

const OWNER = 'pages_owner';
const WS = 'pages_ws';
const X = 'pages_x1';

/** A STAND-IN FOR CHROMIUM (test only): a PDF with one page object per composed page. */
const standIn: import('../../src/services/venture/products/printable.js').Renderer = async (html) => {
  const sections = (html.match(/<section class="page/g) ?? []).length;
  const objs = Array.from({ length: sections }, (_, i) => `${String(i + 3)} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join('\n');
  return { pdf: Buffer.from(`%PDF-1.4\n${objs}\n2 0 obj << /Type /Pages /Count ${String(sections)} >> endobj\n%%EOF\n`, 'latin1'), sections, overflow: [] };
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_pages', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WS, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about, postal_address)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [OWNER, WS, 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '', 'Apex Micro\n11 Example Drive\nMarlborough, MA 01752']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Printable files people keep at home', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('pages_opp',?,?,'a printable house log','homeowners','upkeep lives in their heads','asked for','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('pages_unk',?,'pages_opp','whether anybody pays for a house log',1,'sell one')`, [OWNER]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'pages_opp','pages_unk','sell a printable house log on the Workshop page','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  for (const lens of ['market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio']) {
    await query(`INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by) VALUES (?,?,?,?,'f','["x"]','low','run','b','forge')`, [`pages_${lens}`, X, OWNER, lens]);
  }
  const { recordDesign } = await import('../../src/services/venture/probe-design.js');
  await recordDesign({
    founderId: OWNER, experimentId: X, decides: 'whether a stranger pays for a printable house log', decidesBecause: 'only money settles it',
    exchange: 'upfront_price', exchangeBecause: 'one file, sold once', canProve: 'one pays', cannotProve: 'use',
    ratherThanWaiting: 'reading will not settle it', distribution: 'the Workshop\'s own page; nobody is written to', ifItSucceeds: 'a second file',
    recommendation: 'run', recommendationBecause: 'cheap', designedBy: 'forge',
    interpretations: [{ observation: 'nobody pays', reading: 'not worth it' }, { observation: 'nobody pays', reading: 'not found' }],
    costs: [{ dimension: 'cash', level: 'low', grounds: 'a link' }, { dimension: 'reputation', level: 'low', grounds: 'a page' }, { dimension: 'participant_burden', level: 'none', grounds: 'nobody is written to' }],
    stopConditions: [{ kind: 'complaints', threshold: 2, because: 'a pattern' }, { kind: 'refunds', threshold: 3, because: 'enough' }],
  });
  const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
  await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'front_loaded_attention', treatment: 'prefer', why: 'PENDING 32, allowed', by: `founder:${OWNER}` });
  const { setSendingIdentity } = await import('../../src/services/outbound/sending-identity.js');
  await setSendingIdentity({ productId: WS, provider: 'resend', credential: 're_test', fromEmail: 'hello@apexmicro.example', fromName: 'Apex Micro' });
  P.useRenderer(standIn);
  await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'make_printable_pdf', treatment: 'policy', value: 'yes', why: 'PENDING 41, allowed', by: `founder:${OWNER}` });
});

const made = async () => (await import('../../src/services/venture/products/offer-composition.js')).shapeAndMake(X);
const materials = async () => Number(((await query('SELECT COUNT(*) AS n FROM experiment_materials WHERE experiment_id = ?', [X])).rows[0] as Record<string, unknown>).n);
const printed = PRINTABLE_CONTENT_HONEST.pages.length + 3;
const page = (PRINTABLE_OFFER as unknown as { page: Record<string, string> }).page;

describe('a page count the listing states is the file\'s', () => {
  it('a listing that says thirty pages over a file of nine is refused, with both numbers, and nothing is kept', async () => {
    offer = { ...PRINTABLE_OFFER, page: { ...page, what: 'A 30-page printable bundle with everything you need.' } };
    const r = await made();
    expect('refused' in r ? r.refused : '').toBe(`the listing says 30 pages and the file has ${String(printed)}`);
    expect(await materials()).toBe(0);
  });
  it('the true count passes, and so does a listing that states none', async () => {
    offer = { ...PRINTABLE_OFFER, page: { ...page, what: `A ${String(printed)}-page printable PDF to fill in by hand.` } };
    const r = await made();
    expect('refused' in r ? r.refused : 'made').toBe('made');
  });
});
