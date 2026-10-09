// =============================================================================
// THE FORGE TIMES LAUNCHES BY THE SEASON (F3; residue of F2).
//
// F2 recorded Foundry's own demand monthly and kept seasonal priors labelled
// as assumptions, and nothing that launched a product read either. Now:
//   * the theme is read from a candidate's own words (never a model's);
//   * its season is Foundry's OWN recorded year once twelve months of that
//     theme's real sales exist, and until then the prior, labelled so;
//   * the recorder writes each month's sales per theme, so that year can exist;
//   * the forge lets sealed designs in season-first: one whose window is open
//     takes a free place in flight before one whose peak is most of a year
//     away; nothing is held back by it;
//   * the economics lens reads the season in the record, with its source.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { query } from '../../src/db/client.js';
import { OWNER, seedProductionShape } from '../helpers/world.js';

const SZ = await import('../../src/services/venture/storefront/seasonality.js');
const TODAY = new Date('2026-10-09T08:00:00Z');
let MANDATE = '';

async function aTest(id: string, headline: string): Promise<void> {
  await query(`INSERT INTO venture_opportunities (id, mandate_id, founder_id, headline, who_has_it, the_problem, why_it_might, kill_thesis, sources_json, evidence_mode)
    VALUES (?,?,?,?,'people at home','it lives in their heads','they asked','nobody pays','[]','real')`, [`${id}_opp`, MANDATE, OWNER, headline]);
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,?,1,'sell one')`,
    [`${id}_unk`, OWNER, `${id}_opp`, `whether anybody pays (${id})`]);
  await query(`INSERT INTO venture_experiments (id, founder_id, opportunity_id, unknown_id, what_we_do, what_we_expect, would_disprove, cost_cents, evidence_mode)
    VALUES (?,?,?,?,?,'one pays','nobody pays',1000,'real')`, [id, OWNER, `${id}_opp`, `${id}_unk`, `sell ${headline} on the Workshop page`]);
}

beforeAll(async () => {
  await seedProductionShape();
  const { currentMandate, openMandate } = await import('../../src/services/venture/mandate.js');
  const m = (await currentMandate(OWNER)) ?? await openMandate({ founderId: OWNER, statement: 'Printable files people keep at home', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  MANDATE = m.id;
  await aTest('exp_tax', 'a printable tax organizer for receipts');
  await aTest('exp_holiday', 'a printable holiday gift list');
  await aTest('exp_bid', 'a contractor bid brief');
}, 180_000);

describe('the season of what it sells', () => {
  it('read from its own words; the prior is an assumption and says so; no season when its words name none', async () => {
    const s = await SZ.seasonFor(OWNER, 'a printable tax organizer for receipts', TODAY);
    expect(s).toMatchObject({ theme: 'tax', source: 'assumption', peakMonth: 2 });
    expect(s!.because).toMatch(/assumption/);
    expect(await SZ.seasonFor(OWNER, 'a contractor bid brief', TODAY)).toBeNull();
  });

  it('Foundry\'s own year replaces the prior once twelve months of the theme\'s real sales are recorded', async () => {
    for (let m = 1; m <= 11; m++) await query(`INSERT INTO demand_signals (id, founder_id, month, signal, theme, channel, value, source, evidence_mode) VALUES (?,?,?,'sales','tax','',?, 'test: a recorded month','real')`,
      [`ds_${String(m)}`, OWNER, `2025-${String(m + 1).padStart(2, '0')}`, m === 5 ? 9 : 1]);
    expect((await SZ.seasonFor(OWNER, 'a tax organizer', TODAY))!.source).toBe('assumption');
    await query(`INSERT INTO demand_signals (id, founder_id, month, signal, theme, channel, value, source, evidence_mode) VALUES ('ds_12',?,'2026-01','sales','tax','',1,'test: a recorded month','real')`, [OWNER]);
    const own = (await SZ.seasonFor(OWNER, 'a tax organizer', TODAY))!;
    expect(own).toMatchObject({ source: 'own', peakMonth: 6 });
    expect(own.because).toMatch(/Foundry's own tax sales/);
    await query(`DELETE FROM demand_signals WHERE theme = 'tax'`);
  });

  it('the monthly recorder counts each sale again under its test\'s theme', async () => {
    await query(`INSERT INTO channel_sales (id, founder_id, experiment_id, version, channel, kind, provider_ref, gross_cents, fee_cents, tax_cents, currency, occurred_at, evidence_mode)
      VALUES ('cs_t1', ?, 'exp_tax', 1, 'gumroad', 'sale', 'g_t1', 900, 140, 0, 'usd', '2026-09-12T10:00:00Z', 'real')`, [OWNER]);
    await SZ.recordDemandSignals(OWNER, '2026-09');
    const row = (await query(`SELECT value, source FROM demand_signals WHERE founder_id = ? AND month = '2026-09' AND theme = 'tax' AND signal = 'sales'`, [OWNER])).rows[0] as Record<string, unknown>;
    expect(Number(row.value)).toBe(1);
    expect(String(row.source)).toMatch(/tax theme/);
  });
});

describe('the forge lets sealed designs in season-first', () => {
  it('a design whose window is open goes first; one out of season and one with no season keep their order after it', async () => {
    const order = await SZ.launchOrder(OWNER, [
      { id: 'exp_holiday', text: 'a printable holiday gift list' },
      { id: 'exp_bid', text: 'a contractor bid brief' },
      { id: 'exp_tax', text: 'a printable tax organizer for receipts' },
    ], TODAY);
    expect(order.map((o) => o.id)).toEqual(['exp_tax', 'exp_holiday', 'exp_bid']);
    expect(order[0]!.sentence).toMatch(/window is open/);
    expect(order[0]!.sentence).toMatch(/a prior, an assumption/);
  });

  it('the forge pass orders what it lets in by launchOrder (parsed, so a comment naming it does not count)', () => {
    const sf = ts.createSourceFile('f.ts', readFileSync('src/services/venture/forge-deliberation.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    let inPass = 0;
    const v = (n: ts.Node, fn: string): void => {
      const name = ts.isFunctionDeclaration(n) && n.name ? n.name.text : fn;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'launchOrder' && name === 'forgePass') inPass += 1;
      ts.forEachChild(n, (c) => v(c, name));
    };
    v(sf, '');
    expect(inPass).toBe(1);
  });

  it('the record the lenses read carries the season with its source', async () => {
    const { theRecordOf } = await import('../../src/services/venture/forge-deliberation.js');
    const r = (await theRecordOf('exp_tax'))!;
    expect(r.season).toMatchObject({ theme: 'tax', source: 'assumption' });
    expect((await theRecordOf('exp_bid'))!.season).toBeNull();
  });
});
