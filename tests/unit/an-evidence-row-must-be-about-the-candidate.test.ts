// =============================================================================
// AN EVIDENCE ROW MUST BE ABOUT THE CANDIDATE (F3, relevance.ts).
//
// Wider, fresher eyes bring more rows about something else. Before a row
// reaches the forge's reviewers it must share the candidate's subject — two of
// its content words, as whole words, words every printable shares not
// counting — or it is dropped, and the record says how many were left out.
// Foundry's own sales of products about the subject come first in the record,
// as the strongest signal.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '1'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

const R = await import('../../src/services/venture/relevance.js');

describe('the floor', () => {
  it('two shared content words, as whole words; generic words never count', () => {
    const subject = 'a printable household bills tracker for due dates';
    expect(R.isAbout(subject, 'I pay my household bills late because the due dates live in my head').about).toBe(true);
    expect(R.isAbout(subject, 'a printable template for a wedding, free to print').about).toBe(false);
    // "billsy" and "datesheet" are not the words "bills" and "dates".
    expect(R.isAbout(subject, 'billsy datesheet household').about).toBe(false);
    expect(R.keepWhatIsAbout(subject, ['household bills due', 'my cat is asleep', 'bills and due dates'], (x) => x)).toEqual({ kept: ['household bills due', 'bills and due dates'], dropped: 1 });
  });
});

describe('what the reviewers are given', () => {
  let EXP = '';
  beforeAll(async () => {
    await seedProductionShape();
    const { currentMandate, openMandate } = await import('../../src/services/venture/mandate.js');
    const m = (await currentMandate(OWNER)) ?? await openMandate({ founderId: OWNER, statement: 'Printable files people keep at home', shape: null, evidenceMode: 'real' });
    if ('refused' in m) throw new Error(m.refused);
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
      VALUES ('opp_b', ?, ?, 'a household bills tracker', 'people who pay household bills', 'due dates for bills are missed', 'they asked', 'nobody pays', '[]', 'real')`, [m.id, OWNER]);
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('unk_b', ?, 'opp_b', 'whether anybody pays', 1, 'sell one')`, [OWNER]);
    await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
      VALUES ('exp_b', ?, 'opp_b', 'unk_b', 'sell a household bills tracker', 'one pays', 'nobody pays', 1000, 'real')`, [OWNER]);
    EXP = 'exp_b';
    const { formClaim, observe } = await import('../../src/services/venture/market-evidence.js');
    const claimId = await formClaim({ founderId: OWNER, opportunityId: 'opp_b', evidenceMode: 'real', claim: 'people miss bill due dates' });
    for (const [saw, source] of [['I keep missing due dates on household bills every month', 'https://news.ycombinator.com/item?id=1'],
      ['The keynote was mostly a product launch with a few good demos.', 'https://news.ycombinator.com/item?id=2'],
      ['Our wedding sticker sheet sold out', 'https://www.etsy.com/listing/3']] as const) {
      await observe({ founderId: OWNER, claimId, sourceType: 'community', source, saw, bearing: 'supports', directness: 'direct', observedAt: new Date(), evidenceMode: 'real' });
    }
  }, 180_000);

  it('rows about something else are left out, and counted', async () => {
    const { theRecordOf, recordBlock } = await import('../../src/services/venture/forge-deliberation.js');
    const r = (await theRecordOf(EXP))!;
    expect(r.evidence.map((e) => e.source)).toEqual(['https://news.ycombinator.com/item?id=1']);
    expect(r.evidenceLeftOut).toBe(2);
    expect(recordBlock(r)).toMatch(/EVIDENCE \(2 rows about something else were left out/);
  });

  it('Foundry\'s own products about the subject come first in the record, with what they sold on every channel', async () => {
    // A candidate about the same subject as the seeded, approved test; that test exposed on the Workshop and sold once on Gumroad.
    const seeded = String(((await query(`SELECT id FROM venture_experiments WHERE decision = 'approved' LIMIT 1`)).rows[0] as Record<string, unknown>).id);
    const words = ((await query(`SELECT e.what_we_do, o.headline FROM venture_experiments e LEFT JOIN venture_opportunities o ON o.id = e.opportunity_id WHERE e.id = ?`, [seeded])).rows[0] as Record<string, unknown>);
    const subject = `${String(words.headline ?? '')} ${String(words.what_we_do)}`.slice(0, 300);
    const mandate = String(((await query(`SELECT mandate_id FROM venture_opportunities WHERE id = 'opp_b'`)).rows[0] as Record<string, unknown>).mandate_id);
    await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
      VALUES ('opp_c', ?, ?, ?, 'the same people', ?, 'they asked', 'nobody pays', '[]', 'real')`, [mandate, OWNER, subject, subject]);
    await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES ('unk_c', ?, 'opp_c', 'whether anybody pays again', 1, 'sell one')`, [OWNER]);
    await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
      VALUES ('exp_c', ?, 'opp_c', 'unk_c', ?, 'one pays', 'nobody pays', 1000, 'real')`, [OWNER, String(words.what_we_do)]);
    const { theRecordOf, recordBlock } = await import('../../src/services/venture/forge-deliberation.js');
    // Before it was ever exposed, nothing of Foundry's own is about the subject: an empty list, said so.
    expect((await theRecordOf('exp_c'))!.ownSales).toEqual([]);
    await query(`INSERT INTO experiment_exposures (id, founder_id, experiment_id, provider, exposure_ref, evidence_mode, placed_by) VALUES ('x_own', ?, ?, 'stripe', 'plink_own', 'real', 'test')`, [OWNER, seeded]);
    await query(`INSERT INTO channel_sales (id, founder_id, experiment_id, version, channel, kind, provider_ref, gross_cents, fee_cents, tax_cents, currency, occurred_at, evidence_mode)
      VALUES ('cs_own', ?, ?, 1, 'gumroad', 'sale', 'g_own', 900, 140, 0, 'usd', datetime('now','-3 days'), 'real')`, [OWNER, seeded]);
    const r = (await theRecordOf('exp_c'))!;
    expect(r.ownSales).toEqual([expect.objectContaining({ experimentId: seeded, channels: [expect.objectContaining({ channel: 'gumroad', sales: 1, grossCents: 900 })] })]);
    const block = recordBlock(r);
    expect(block.indexOf('OWN SALES')).toBeLessThan(block.indexOf('EVIDENCE'));
  });
});
