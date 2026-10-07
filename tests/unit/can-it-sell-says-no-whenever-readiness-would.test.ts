// =============================================================================
// "CAN FOUNDRY SELL ON ITS OWN?" SAYS NO WHENEVER READINESS WOULD REFUSE
// (Stage 1, F1.6).
//
// Controls' verdict read secrets, the payment route, the charter, the per-sale
// minutes decision and the model door. `readiness` — the gate every test must
// pass before it is let in — also refuses for what the Workshop lacks (no
// Workshop, no postal address, new economic activity paused), for sending that
// is not connected, and for what the first-proof policy says of the offer. So
// Controls could say "yes" while every forge-made test was refused.
//
// The verdict now reads those through the functions readiness itself uses.
// What is proved here, against a real forge-shaped Workshop test: for each of
// those gates, broken one at a time, readiness refuses in its own words, and
// the verdict is "no" with the same words; mended, both lose the sentence.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { COMPANY, OWNER, seedProductionShape } from '../helpers/world.js';

const X = 'sell_ws_x';

async function bothSay(experimentId = X, founderId = OWNER): Promise<{ readiness: string[]; verdict: { yes: boolean; blockers: string[] } }> {
  const { readiness } = await import('../../src/services/venture/hand.js');
  const { canSellOnItsOwn, productionFacts } = await import('../../src/services/control/production-facts.js');
  return { readiness: (await readiness(experimentId)).missing, verdict: canSellOnItsOwn(await productionFacts(founderId)) };
}

/** A test shaped as the forge shapes one: on the Workshop's page, a one-time brief, with the brief's facts. */
async function aWorkshopTest(founderId: string, mandateId: string, id: string): Promise<void> {
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
     VALUES (?,?,?,'a brief','contractors','by hand','said so','one firm','[]','real')`, [`${id}_opp`, mandateId, founderId]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test)
     VALUES (?,?,?,'whether anyone pays',1,'offer one')`, [`${id}_unk`, founderId, `${id}_opp`]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
     VALUES (?,?,?,?,'offer one on the page','one pays','nobody pays',1000,'real')`, [id, founderId, `${id}_opp`, `${id}_unk`]);
  const { briefFacts } = await import('../../src/services/venture/products/offer-composition.js');
  const { recordMaterial } = await import('../../src/services/venture/hand.js');
  await recordMaterial({ founderId, experimentId: id, kind: 'offer_shape', title: 'shape', by: 'test', body: JSON.stringify({
    shape: { sells: 'a brief', claimsMade: 'a shortlist', collects: 'an email', deliversBy: 'email', sellsTo: 'anyone who finds the page', chargesHow: 'one-time, $19' },
    lighter: 'nothing lighter settles it', venue: 'workshop', kind: 'data_brief', facts: briefFacts(), price: { amountCents: 1900, currency: 'usd' }, offerSubject: 'A brief' }) });
}

beforeAll(async () => {
  await seedProductionShape();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['sell_elsewhere', 'clk_elsewhere', 'elsewhere@example.com', 'Somebody else']);
  // The world's own search stands; the test sits under it.
  const mine = String((await query('SELECT id FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL', [OWNER])).rows[0]!.id);
  await aWorkshopTest(OWNER, mine, X);
  // An owner with no Workshop at all, and the same kind of test.
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const other = await openMandate({ founderId: 'sell_elsewhere', statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in other) throw new Error(other.refused);
  await aWorkshopTest('sell_elsewhere', other.id, 'sell_nows_x');
}, 180_000);

describe('each gate readiness refuses for, the verdict refuses for too', () => {
  const gates: Array<{ name: string; says: RegExp; is: string; breakIt: () => Promise<void>; mendIt: () => Promise<void> }> = [
    { name: 'new economic activity paused', says: /^new economic activity is paused$/, is: 'new economic activity is paused',
      breakIt: async () => { const { pauseNewEconomicActivity } = await import('../../src/services/public-workshop/settings.js'); await pauseNewEconomicActivity({ founderId: OWNER, reason: 'a rehearsal' }); },
      mendIt: async () => { const { resumeEconomicActivity } = await import('../../src/services/public-workshop/settings.js'); await resumeEconomicActivity(OWNER); } },
    { name: 'no postal address', says: /^the Workshop has no postal address/, is: 'the Workshop has no postal address for commercial mail',
      breakIt: async () => { await query('UPDATE public_workshop SET postal_address = NULL WHERE founder_id = ?', [OWNER]); },
      mendIt: async () => { const { setPostalAddress } = await import('../../src/services/public-workshop/settings.js'); await setPostalAddress(OWNER, 'Thomas Norton\n11 Apex Drive Suite 300A #361\nMarlborough, MA 01752'); } },
    { name: 'sending not connected', says: /^email sending is not connected/, is: 'email sending is not connected',
      breakIt: async () => { await query('UPDATE product_sending_identities SET from_email = ? WHERE product_id = ?', ['someone@elsewhere.example', COMPANY]); },
      mendIt: async () => {
        const { publicWorkshopOf } = await import('../../src/services/public-workshop/settings.js');
        const w = (await publicWorkshopOf(OWNER))!;
        await query('UPDATE product_sending_identities SET from_email = ? WHERE product_id = ?', [w.contactEmail, COMPANY]);
      } },
  ];

  for (const g of gates) {
    it(`${g.name}: readiness refuses and the verdict is no, in the same words; mended, neither says it`, async () => {
      const before = await bothSay();
      expect(before.readiness).not.toContain(g.is);
      expect(before.verdict.blockers.some((b) => g.says.test(b))).toBe(false);
      await g.breakIt();
      try {
        const broken = await bothSay();
        expect(broken.readiness).toContain(g.is);
        expect(broken.verdict.yes).toBe(false);
        expect(broken.verdict.blockers.some((b) => g.says.test(b))).toBe(true);
      } finally { await g.mendIt(); }
      const after = await bothSay();
      expect(after.readiness).not.toContain(g.is);
      expect(after.verdict.blockers.some((b) => g.says.test(b))).toBe(false);
    });
  }

  it('no Workshop at all: readiness refuses and the verdict is no, in the same words', async () => {
    const { readiness, verdict } = await bothSay('sell_nows_x', 'sell_elsewhere');
    expect(readiness).toContain('there is no public Workshop to carry the page');
    expect(verdict.yes).toBe(false);
    expect(verdict.blockers).toContain('there is no public Workshop to carry the page');
    // The owner who has one is not told he lacks it.
    expect((await bothSay()).verdict.blockers).not.toContain('there is no public Workshop to carry the page');
  });

  it('what placing the forge\'s offer would be refused for, readiness and the verdict say alike', async () => {
    // By default the first-proof policy requires attention spent once, and a
    // forge-made brief says truthfully that it is not: readiness refuses it.
    const { readiness, verdict } = await bothSay();
    const placing = readiness.filter((m) => m.startsWith('placing it would be refused: '));
    expect(placing.length).toBeGreaterThan(0);
    for (const p of placing) expect(verdict.blockers).toContain(p);
    expect(verdict.yes).toBe(false);
    // His own "prefer" lifts the requirement from both at once.
    const { supersedeOriginationPolicy } = await import('../../src/services/venture/legal-surface.js');
    const r = await supersedeOriginationPolicy({ founderId: OWNER, requirement: 'front_loaded_attention', treatment: 'prefer',
      why: 'a rehearsal of his decision', by: `founder:${OWNER}` });
    expect('refused' in r ? r.refused : '').toBe('');
    const now = await bothSay();
    const still = now.readiness.filter((m) => m.startsWith('placing it would be refused: '));
    expect(still.some((m) => /front loaded attention/.test(m))).toBe(false);
    expect(now.verdict.blockers.some((b) => /placing it would be refused: .*front loaded attention/.test(b))).toBe(false);
    for (const p of still) expect(now.verdict.blockers).toContain(p);
  });

  it('with every gate mended, it can: the verdict is not a "no" that cannot be anything else', async () => {
    const { signCharter } = await import('../../src/services/institution/charter.js');
    await signCharter({ founderId: OWNER, testsTotalCents: 10_000, probesInFlight: 3, cognitionCentsPerDay: 300, days: 90, publicVoice: 'Apex Micro', statement: 'A quarter.' });
    await query(`INSERT INTO stripe_webhook_events (event_id, event_type, processed_at, livemode) VALUES ('evt_sell_live', 'payment_intent.succeeded', datetime('now', '-1 days'), 1)`, []);
    const { canSellOnItsOwn, productionFacts } = await import('../../src/services/control/production-facts.js');
    const r = canSellOnItsOwn(await productionFacts(OWNER, { ...process.env, STRIPE_SECRET_KEY: 'sk_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }));
    expect(r.blockers).toEqual([]);
    expect(r.yes).toBe(true);
  });

  it('the verdict is never yes while readiness refuses the forge\'s offer for a reason that is not the test\'s own', async () => {
    const { readiness, verdict } = await bothSay();
    const deploymentLevel = readiness.filter((m) => m === 'new economic activity is paused' || m.startsWith('the Workshop has no postal')
      || m === 'there is no public Workshop to carry the page' || m === 'email sending is not connected' || m.startsWith('placing it would be refused: '));
    if (deploymentLevel.length > 0) expect(verdict.yes).toBe(false);
    for (const m of deploymentLevel) expect(verdict.blockers.some((b) => b.startsWith(m))).toBe(true);
  });
});

// READY IS NOT SELLING (stage-1 audit). Over thirty simulated days with every
// door open, Controls showed a green "Yes" while the forge had designed nothing
// and no page was up. The verdict now says, from the real tables, that nothing
// is on sale, and Controls stops rendering it as a plain "Yes".
describe('a "yes" with nothing on a page says nothing is on sale', () => {
  it('reads the designs and live offers from the database, not a constant', async () => {
    const { productionFacts } = await import('../../src/services/control/production-facts.js');
    const f = await productionFacts(OWNER);
    const designs = Number((await query('SELECT COUNT(*) AS n FROM probe_designs WHERE founder_id = ?', [OWNER])).rows[0]!.n);
    expect(f.designed).toBe(designs);
    expect(f.onOffer).toBe(0);
  });

  it('names what is missing: nothing designed, or designed but never placed; quiet once an offer is up', async () => {
    const { canSellOnItsOwn, productionFacts } = await import('../../src/services/control/production-facts.js');
    const base = await productionFacts(OWNER);
    expect(canSellOnItsOwn({ ...base, designed: 0, onOffer: 0 }).nothingOnSale).toMatch(/not designed anything/);
    expect(canSellOnItsOwn({ ...base, designed: 3, onOffer: 0 }).nothingOnSale).toMatch(/designed 3 but none has reached a page/);
    expect(canSellOnItsOwn({ ...base, designed: 3, onOffer: 1 }).nothingOnSale).toBeNull();
  });
});
