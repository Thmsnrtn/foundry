process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
process.env.OPENROUTER_API_KEY = 'test-key';

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PRINTABLE_CONTENT_HONEST, PRINTABLE_OFFER } from '../fixtures/printable-home-maintenance.js';

// =============================================================================
// A SPLIT PANEL WAITS FOR THE OWNER, AS ONE ITEM (Stage 2, C2).
//
// The printable kind is the owner's to turn on (PENDING 38): without his own
// row the forge is never offered it. When it is on and the strangers are
// split — the bench's own result, no yes, four maybes, one no — the file is
// made and kept, and it does not ship: readiness says it is held, and he is
// asked once, with the file to read. Only he can release it, and releasing
// changes nothing but the hold.
//
// Chromium is not needed here: the renderer is the one function a test may
// stand in for, and the stand-in returns a PDF with the composed pages.
// =============================================================================

const calls: string[] = [];
const SPLIT = [
  { verdict: 'maybe', max_price_dollars: 9, why: 'Useful, not sure I would pay.' },
  { verdict: 'maybe', max_price_dollars: 12, why: 'Maybe for a new house.' },
  { verdict: 'maybe', max_price_dollars: 7, why: 'I could make one.' },
  { verdict: 'no', max_price_dollars: 0, why: 'I use my phone for this.' },
];
const say = (o: unknown) => ({ content: JSON.stringify(o), tokensUsed: 1, costUsd: 0 });
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callSonnet: vi.fn(async (system: string) => {
    if (system.startsWith('You shape the offer')) { calls.push(system.includes('THE HANDS CAN ALSO MAKE A PRINTABLE') ? 'compose+printable' : 'compose'); return say(PRINTABLE_OFFER); }
    if (system.startsWith('You write the pages of a printable')) { calls.push('write'); return say(PRINTABLE_CONTENT_HONEST); }
    if (system.startsWith('You check a printable file')) { calls.push('check'); return say({ invented: [], regulated_advice: false }); }
    const k = calls.filter((c) => c === 'persona').length;
    calls.push('persona');
    return say(SPLIT[k % SPLIT.length]);
  }),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const P = await import('../../src/services/venture/products/printable.js');

const OWNER = 'split_owner';
const WS = 'split_ws';
const X = 'split_x1';

/** A STAND-IN FOR CHROMIUM (test only): a PDF with one page object per composed page. */
const standIn: import('../../src/services/venture/products/printable.js').Renderer = async (html) => {
  const sections = (html.match(/<section class="page/g) ?? []).length;
  const objs = Array.from({ length: sections }, (_, i) => `${String(i + 3)} 0 obj << /Type /Page /Parent 2 0 R >> endobj`).join('\n');
  return { pdf: Buffer.from(`%PDF-1.4\n${objs}\n2 0 obj << /Type /Pages /Count ${String(sections)} >> endobj\n%%EOF\n`, 'latin1'), sections, overflow: [] };
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_split', 'owner@example.com', 'Thomas Norton']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES (?,'Apex Micro',?,'active','real')", [WS, OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about, postal_address)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [OWNER, WS, 'Apex Micro', 'Thomas Norton', 'https://apexmicro.example', 'apexmicro.example', 'hello@apexmicro.example', 'A small workshop.', '', 'Apex Micro\n11 Example Drive\nMarlborough, MA 01752']);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Printable files people keep at home', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES ('split_opp',?,?,'a printable house log','homeowners','upkeep lives in their heads','asked for','nobody pays','[]','real')`, [m.id, OWNER]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('split_unk',?,'split_opp','whether anybody pays for a house log',1,'sell one')`, [OWNER]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,'split_opp','split_unk','sell a printable house log on the Workshop page','one pays','nobody pays',1000,'real')`, [X, OWNER]);
  for (const lens of ['market_reality', 'experimental_design', 'commercial_operations', 'risk_ethics_compliance', 'economics_portfolio']) {
    await query(`INSERT INTO probe_lens_findings (id, experiment_id, founder_id, lens, finding, grounds_json, risk, recommends, because, recorded_by) VALUES (?,?,?,?,'f','["x"]','low','run','b','forge')`, [`split_${lens}`, X, OWNER, lens]);
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
});

describe('the kind is the owner\'s to turn on', () => {
  it('until his own row says yes, the forge is not offered a printable and makes a brief instead', async () => {
    expect((await P.mayMakePrintables(OWNER)).may).toBe(false);
    const { yourDecisions } = await import('../../src/services/control/decisions.js');
    expect((await yourDecisions(OWNER)).find((d) => d.key === 'printables')).toMatchObject({ state: 'open' });
    const { shapeAndMake } = await import('../../src/services/venture/products/offer-composition.js');
    const made = await shapeAndMake(X);
    expect(calls).toEqual(['compose']);
    // Read as a brief, which needs search words and coverage a file does not have: refused, never made as a file.
    expect('refused' in made && made.refused).toBe('the offer left out terms, coverage');
    const { materialOf } = await import('../../src/services/venture/hand.js');
    expect(await materialOf(X, 'deliverable')).toBeNull();
  });

  it('a principal that is not the owner cannot say yes for him', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'make_printable_pdf', treatment: 'policy', value: 'yes', why: 'the forge decided', by: 'institution:forge' });
    expect('refused' in r).toBe(true);
    expect((await P.mayMakePrintables(OWNER)).may).toBe(false);
  });
});

describe('a split panel', () => {
  it('makes and keeps the file, holds it, and readiness says why', async () => {
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'make_printable_pdf', treatment: 'policy', value: 'yes', why: 'PENDING 38: yes', by: `founder:${OWNER}` });
    calls.length = 0;
    const { shapeAndMake } = await import('../../src/services/venture/products/offer-composition.js');
    const made = await shapeAndMake(X);
    expect('refused' in made ? made.refused : 'made').toBe('made');
    expect(calls).toEqual(['compose+printable', 'write', 'check', 'persona', 'persona', 'persona', 'persona']);
    const { materialOf, readiness } = await import('../../src/services/venture/hand.js');
    const plan = P.printablePlanOf((await materialOf(X, 'offer_shape'))!.body)!;
    expect(plan.held).toMatch(/split: 0 yes, 3 maybe, 1 no/);
    const ready = await readiness(X);
    expect(ready.ok).toBe(false);
    expect(ready.missing.join(' ')).toMatch(/held for you: the strangers were split/);
  });

  it('reaches him as ONE needs-you item, with the file to read', async () => {
    const { needsYou } = await import('../../src/services/needs-you/queue.js');
    const { items } = await needsYou(OWNER);
    const about = items.filter((i) => i.href.includes(X) || (i.item?.yes?.action ?? '').includes(X));
    expect(about).toHaveLength(1);
    expect(about[0]!.summary).toMatch(/Would a stranger pay for "The Home Maintenance Log"\? The panel was split/);
    expect(about[0]!.item!.yes!.action).toBe(`/foundry/experiments/${X}/printable/release`);
    expect(about[0]!.item!.open!.href).toBe(`/foundry/experiments/${X}/printable.pdf`);
  });

  it('only he can release it, and releasing lifts the hold and nothing else', async () => {
    expect((await P.releaseHeldPrintable({ founderId: OWNER, experimentId: X, by: 'charter:abc' })).released).toBe(false);
    const { materialOf, readiness } = await import('../../src/services/venture/hand.js');
    const before = (await materialOf(X, 'deliverable'))!;
    const r = await P.releaseHeldPrintable({ founderId: OWNER, experimentId: X, by: `founder:${OWNER}` });
    expect(r.released).toBe(true);
    expect((await materialOf(X, 'deliverable'))!.id).toBe(before.id);
    const plan = P.printablePlanOf((await materialOf(X, 'offer_shape'))!.body)!;
    expect(plan).toMatchObject({ held: null, releasedBy: `founder:${OWNER}` });
    expect((await readiness(X)).missing.join(' ')).not.toMatch(/held for you/);
    const { needsYou } = await import('../../src/services/needs-you/queue.js');
    expect((await needsYou(OWNER)).items.filter((i) => i.summary.includes('The panel was split'))).toEqual([]);
  });

  it('a stored file whose bytes changed after the check is refused at the gate', async () => {
    const { materialOf, deliverableGate } = await import('../../src/services/venture/hand.js');
    const goods = (await materialOf(X, 'deliverable'))!;
    expect(await deliverableGate(X, goods, new Date())).toEqual({ ok: true, failures: [] });
    const m = JSON.parse(goods.body) as { pdfBase64: string };
    const tampered = { ...goods, body: JSON.stringify({ ...JSON.parse(goods.body), pdfBase64: Buffer.from(Buffer.from(m.pdfBase64, 'base64').toString('latin1').replace('%%EOF', '%%EOF ')).toString('base64') }) };
    expect((await deliverableGate(X, tampered, new Date())).failures.join(' ')).toMatch(/not the file that was checked/);
  });
});
