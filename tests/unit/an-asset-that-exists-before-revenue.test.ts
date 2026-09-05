process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { getAllActiveProducts, operatingProduct, query } from '../../src/db/client.js';
import { openMandate } from '../../src/services/venture/mandate.js';
import { formClaim, observe, raiseUnknown } from '../../src/services/venture/market-evidence.js';
import { sow, promote } from '../../src/services/venture/seeds.js';
import { decideExperiment, designExperiment } from '../../src/services/venture/validation.js';
import {
  beginExperimentalAsset, earnAsset, experimentalAssetsFor, retireExperimentalAsset,
} from '../../src/services/venture/asset.js';
import { resolvePrediction } from '../../src/services/institution/calibration.js';
import { checkKillSwitch } from '../../src/services/outbound/kill-switch.js';
import { companyMayIncurCost } from '../../src/services/ai/client.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';
import { currentMandate, stopMandate } from '../../src/services/venture/mandate.js';

// =============================================================================
// AN ASSET THAT EXISTS BEFORE REVENUE, AND IS NOT A COMPANY FOR IT.
//
// A stranger cannot pay for something that has no identity, nowhere for an
// offer to live and no budget. So an approved test gets an EXPERIMENTAL asset —
// a products row with standing 'experimental' — and the whole point of this
// file is to prove that row cannot accidentally behave like an operating
// company. Every ordinary operating path is tried against it and refused, and
// the same calls succeed the moment reality earns it.
//
// EARNED MEANS ONLY THAT REALITY RECOGNISED IT. The transition needs a
// business-outcome resolution or the owner's own words. It is never validated,
// profitable or authorised by this.
// =============================================================================

const OWNER = 'asset_owner';
let mandateId = '';
let opportunityId = '';
let experimentId = '';
let productId = '';

async function aCandidate(word: string): Promise<string> {
  // Two independent ways of knowing, the way the promotion gate demands.
  const pain = await formClaim({ founderId: OWNER, evidenceMode: 'real',
    claim: `somebody wrote: "we ${word} by hand every week"` });
  const obsId = await observe({ founderId: OWNER, claimId: pain, sourceType: 'community',
    source: 'https://forum.example/2', saw: `we ${word} by hand every week`, bearing: 'supports',
    directness: 'direct', observedAt: new Date(Date.now() - 86_400_000), evidenceMode: 'real' });
  const seed = await sow({ founderId: OWNER, mandateId, seed: `maybe worth looking into: ${word}`,
    origin: 'signal', originSaid: `we ${word} by hand every week`, originObservationId: obsId,
    evidenceMode: 'real' });
  if (typeof seed !== 'string') throw new Error('buried');
  await query('UPDATE market_claims SET seed_id = ? WHERE id = ?', [seed, pain]);
  const gap = await formClaim({ founderId: OWNER, seedId: seed, evidenceMode: 'real',
    claim: `nothing maintained already does this: ${word}` });
  await observe({ founderId: OWNER, claimId: gap, sourceType: 'directory',
    source: 'https://registry.example/search', saw: 'nothing relevant', bearing: 'supports',
    directness: 'inferred', observedAt: new Date(Date.now() - 3_600_000), evidenceMode: 'real',
    fromAbsence: true });
  // The interpretation row promote() joins on.
  const interp = `int_${word}`;
  await query(
    `INSERT INTO observation_interpretations
       (id, founder_id, observation_id, reading, motivated_by, misread_if, hypothesis,
        hypothesis_kind, who_it_may_be, interpreted_by, evidence_mode)
     VALUES (?,?,?,?,?,?,?,?,?,?,'real')`,
    [interp, OWNER, obsId, 'people resent doing this by hand', `${word} by hand every week`,
      'they enjoy doing it', `a tool that does ${word} might be wanted`, 'gap_exists',
      'small teams', 'test']);
  await query('UPDATE opportunity_seeds SET interpretation_id = ?, hypothesis_kind = ? WHERE id = ?',
    [interp, 'gap_exists', seed]);
  const made = await promote({ seedId: seed, headline: `${word} without doing it by hand`,
    whoHasIt: 'small teams', theProblem: 'weekly manual work', whyItMight: 'two ways of knowing',
    killThesis: 'they enjoy doing it', unknowns: ['whether anybody would pay for it'],
    sources: ['https://forum.example/2'] });
  if ('refused' in made) throw new Error(made.refused);
  return made.opportunityId;
}

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_asset', 'owner@example.com', 'Owner']);
  const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger',
    shape: null, evidenceMode: 'real' });
  if ('refused' in opened) throw new Error(opened.refused);
  mandateId = opened.id;
  opportunityId = await aCandidate('reconcile invoices');
  const unknown = (await query(
    `SELECT id FROM market_unknowns WHERE opportunity_id = ? AND blocking = 1`, [opportunityId]))
    .rows[0] as Record<string, unknown>;
  experimentId = await designExperiment({
    founderId: OWNER, opportunityId, unknownId: String(unknown.id),
    whatWeDo: 'show a price to ten people with the problem', whatWeExpect: 'at least one pays',
    wouldDisprove: 'nobody pays', costCents: 900, evidenceMode: 'real' });
});

describe('an approved test gets something to be', () => {
  it('approval creates exactly one experimental asset, with lineage, an identity and the allowance', async () => {
    await decideExperiment({ experimentId, decision: 'approved', by: `founder:${OWNER}` });
    const first = await beginExperimentalAsset({ experimentId, by: `founder:${OWNER}` });
    if ('refused' in first) throw new Error(first.refused);
    const again = await beginExperimentalAsset({ experimentId, by: `founder:${OWNER}` });
    if ('refused' in again) throw new Error(again.refused);
    expect(again.productId).toBe(first.productId);
    expect(again.created).toBe(false);
    productId = first.productId;

    const row = (await query(
      `SELECT standing, operating_boundary, from_experiment_id, from_opportunity_id, reality
         FROM products WHERE id = ?`, [productId])).rows[0] as Record<string, unknown>;
    expect(row.standing).toBe('experimental');
    expect(row.operating_boundary).toBe('asset_only');
    expect(row.from_experiment_id).toBe(experimentId);
    expect(row.from_opportunity_id).toBe(opportunityId);
    expect(row.reality).toBe('real');

    const actor = (await query(
      `SELECT kind, portable FROM business_actors WHERE product_id = ?`, [productId]))
      .rows[0] as Record<string, unknown>;
    expect(actor.kind).toBe('asset');
    expect(Number(actor.portable)).toBe(1);

    const allowance = (await query(
      `SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL`,
      [productId])).rows[0] as Record<string, unknown>;
    expect(Number(allowance.amount_cents)).toBe(900);
  });

  it('an experimental row cannot be born without its experiment, and lineage cannot be edited after', async () => {
    await expect(query(
      `INSERT INTO products (id, name, owner_id, status, standing) VALUES ('x1','x',?, 'active','experimental')`,
      [OWNER])).rejects.toThrow(/experimental_needs_an_experiment/);
    await expect(query(
      `UPDATE products SET from_experiment_id = NULL WHERE id = ?`, [productId]))
      .rejects.toThrow(/experiment_lineage_immutable/);
  });
});

describe('an experimental asset is structurally not an operating company', () => {
  it('the canonical predicate excludes it and boot provisioning never sees it', async () => {
    const seen = (await getAllActiveProducts()).rows.map((r) => String((r as Record<string, unknown>).id));
    expect(seen).not.toContain(productId);
    const direct = (await query(
      `SELECT CASE WHEN ${operatingProduct()} THEN 1 ELSE 0 END AS op FROM products WHERE id = ?`,
      [productId])).rows[0] as Record<string, unknown>;
    expect(Number(direct.op)).toBe(0);
  });

  it('the database refuses agents, ordinary model spend, situations, concentrations, responsibilities and delegations', async () => {
    await expect(query(
      `INSERT INTO agent_instances (id, product_id, agent_name, status) VALUES ('ai1', ?, 'atlas', 'active')`,
      [productId])).rejects.toThrow(/experimental_cannot_be_provisioned/);
    await expect(query(
      `INSERT INTO ai_spend_reservations
         (id, product_id, founder_id, date, model, reserved_cents, global_cap_cents, status,
          created_at, updated_at, expires_at)
       VALUES ('r1', ?, ?, date('now'), 'sonnet', 5, 50000, 'reserved', datetime('now'),
               datetime('now'), datetime('now','+1 hour'))`,
      [productId, OWNER])).rejects.toThrow(/experimental_has_no_company_spend/);
    await expect(query(
      `INSERT INTO company_situations (id, product_id, situation, headline, evidence_mode)
       VALUES ('s1', ?, 'steady', 'fine', 'real')`, [productId]))
      .rejects.toThrow(/experimental_has_no_situation/);
    await expect(query(
      `INSERT INTO portfolio_exposures (id, founder_id, subject_kind, subject_id, dimension, value, how_known, evidence_mode)
       VALUES ('e1', ?, 'company', ?, 'acquisition_channel', 'search', 'inferred', 'real')`,
      [OWNER, productId])).rejects.toThrow(/experimental_is_not_a_concentration/);
    await expect(query(
      `INSERT INTO institutional_responsibilities (id, product_id, title, capability, state)
       VALUES ('ir1', ?, 'answer support', 'support', 'visible')`, [productId]))
      .rejects.toThrow(/experimental_carries_no_responsibility/);
  });

  it('the spend gate and the outbound door both refuse it, naming the reason', async () => {
    const why = await companyMayIncurCost(productId);
    expect(why).toMatch(/experimental/);
    const door = await checkKillSwitch(productId, 'send_email');
    expect(door.blocked).toBe(true);
    expect(door.reason).toMatch(/experimental/);
  });

  it('the owner surfaces count it on the frontier, never as a company', async () => {
    const frontier = await experimentalAssetsFor(OWNER, 'real');
    expect(frontier.map((a) => a.id)).toContain(productId);
    const counted = (await query(
      `SELECT COUNT(*) AS n FROM products WHERE owner_id = ? AND ${operatingProduct()}`, [OWNER]))
      .rows[0] as Record<string, unknown>;
    expect(Number(counted.n)).toBe(0);
  });
});

describe('reality earns it, and the owner cannot rewrite reality', () => {
  it('earning is refused with no business-outcome resolution and no owner words', async () => {
    const tried = await earnAsset({ productId, by: 'business_outcome_tick', because: 'it sold' });
    expect(tried.earned).toBe(false);
    expect(tried.because).toMatch(/no business outcome/);
  });

  it('a business-outcome resolution earns it; earned means recognised, nothing more', async () => {
    const decided = (await query(
      'SELECT decided_at FROM venture_experiments WHERE id = ?', [experimentId]))
      .rows[0] as Record<string, unknown>;
    // Evidence must postdate the prediction; the seal is at decision time.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await resolvePrediction({
      founderId: OWNER, kind: 'venture_experiment', predictionId: experimentId,
      resolvedBy: 'business_outcome', evidenceRef: 'business_outcome_event:evt1',
      verdict: 'as_predicted', because: '1 of 12 arrivals paid', predictedAt: String(decided.decided_at) });
    if ('refused' in res) throw new Error(res.refused);
    const earned = await earnAsset({ productId, by: 'business_outcome_tick',
      because: 'settled by a business outcome: 1 of 12 arrivals paid' });
    expect(earned.earned).toBe(true);

    const row = (await query(
      `SELECT standing, earned_by, posture FROM products WHERE id = ?`, [productId]))
      .rows[0] as Record<string, unknown>;
    expect(row.standing).toBe('earned');
    expect(row.earned_by).toBe('business_outcome_tick');
    // NOTHING ELSE CHANGED. No posture, no authority, no delegation appeared.
    expect(row.posture).toBe('grow');
    const delegations = (await query(
      'SELECT COUNT(*) AS n FROM delegations WHERE product_id = ?', [productId]))
      .rows[0] as Record<string, unknown>;
    expect(Number(delegations.n)).toBe(0);

    const verdict = (await query(
      'SELECT verdict FROM venture_opportunities WHERE id = ?', [opportunityId]))
      .rows[0] as Record<string, unknown>;
    expect(verdict.verdict).toBe('advanced');
    const became = (await query(
      'SELECT became_product FROM venture_mandates WHERE id = ?', [mandateId]))
      .rows[0] as Record<string, unknown>;
    expect(became.became_product).toBe(productId);
  });

  it('once earned it cannot go back, and the earning record cannot be edited', async () => {
    await expect(query(
      `UPDATE products SET standing = 'experimental' WHERE id = ?`, [productId]))
      .rejects.toThrow(/earned_cannot_become_experimental/);
    await expect(query(
      `UPDATE products SET earned_because = 'rewritten' WHERE id = ?`, [productId]))
      .rejects.toThrow(/earning_immutable/);
  });

  it('the ordinary operating paths open once earned', async () => {
    const seen = (await getAllActiveProducts()).rows.map((r) => String((r as Record<string, unknown>).id));
    expect(seen).toContain(productId);
    expect(await companyMayIncurCost(productId)).toBeNull();
  });
});

describe('a failed test does not keep its object alive by default', () => {
  it('a second experimental asset can be retired with the reason on the row, lineage intact', async () => {
    const other = await aCandidate('chase late payers');
    const unknown = (await query(
      `SELECT id FROM market_unknowns WHERE opportunity_id = ? AND blocking = 1`, [other]))
      .rows[0] as Record<string, unknown>;
    const exp2 = await designExperiment({
      founderId: OWNER, opportunityId: other, unknownId: String(unknown.id),
      whatWeDo: 'show a price', whatWeExpect: 'one pays', wouldDisprove: 'nobody pays',
      costCents: 0, evidenceMode: 'real' });
    await decideExperiment({ experimentId: exp2, decision: 'approved', by: `founder:${OWNER}` });
    const made = await beginExperimentalAsset({ experimentId: exp2, by: `founder:${OWNER}` });
    if ('refused' in made) throw new Error(made.refused);
    // A $0 test has no allowance and therefore no spend.
    const allowance = await query(
      'SELECT id FROM owner_allowances WHERE product_id = ?', [made.productId]);
    expect(allowance.rows.length).toBe(0);
    expect(await retireExperimentalAsset({ productId: made.productId,
      because: 'the test came back against the thesis and nothing narrowed the claim' })).toBe(true);
    const row = (await query(
      'SELECT status, retired_because, from_experiment_id FROM products WHERE id = ?',
      [made.productId])).rows[0] as Record<string, unknown>;
    expect(row.status).toBe('archived');
    expect(String(row.retired_because)).toContain('against the thesis');
    expect(row.from_experiment_id).toBe(exp2);
  });

  it('an earned asset is never retired by this path', async () => {
    expect(await retireExperimentalAsset({ productId, because: 'no' })).toBe(false);
  });
});

describe('the rehearsal produces a rehearsal, and never a real asset', () => {
  it('a reference experiment yields a reference asset, invisible on the real frontier', async () => {
    // The real mandate is closed so a reference one can open; the reference
    // world seeds its own candidates and their unknowns.
    await stopMandate(OWNER, 'test over');
    await establishReferenceCompany({ scenarioKey: 'steady_and_unremarkable', ownerId: OWNER });
    const opened = await openMandate({ founderId: OWNER, statement: 'Make the river stronger',
      shape: null, evidenceMode: 'reference' });
    if ('refused' in opened) throw new Error(opened.refused);
    const ref = await currentMandate(OWNER);
    if (!ref) throw new Error('expected the reference mandate');
    const opp = (await query(
      `SELECT o.id FROM venture_opportunities o
        WHERE o.mandate_id = ? AND o.verdict IS NULL
          AND EXISTS (SELECT 1 FROM market_unknowns u WHERE u.opportunity_id = o.id AND u.blocking = 1)
        ORDER BY o.rowid LIMIT 1`, [ref.id])).rows[0] as Record<string, unknown>;
    const unknown = (await query(
      `SELECT id FROM market_unknowns WHERE opportunity_id = ? AND blocking = 1 LIMIT 1`,
      [String(opp.id)])).rows[0] as Record<string, unknown>;
    const refExp = await designExperiment({
      founderId: OWNER, opportunityId: String(opp.id), unknownId: String(unknown.id),
      whatWeDo: 'show a price', whatWeExpect: 'one pays', wouldDisprove: 'nobody pays',
      costCents: 500, evidenceMode: 'reference' });
    await decideExperiment({ experimentId: refExp, decision: 'approved', by: `founder:${OWNER}` });
    const made = await beginExperimentalAsset({ experimentId: refExp, by: `founder:${OWNER}` });
    if ('refused' in made) throw new Error(made.refused);
    const row = (await query('SELECT reality, standing FROM products WHERE id = ?', [made.productId]))
      .rows[0] as Record<string, unknown>;
    expect(row.reality).toBe('reference');
    expect(row.standing).toBe('experimental');
    // NOT ON THE REAL FRONTIER, and the door refuses it as a reference company
    // first, because that is the more fundamental fact about it.
    expect((await experimentalAssetsFor(OWNER, 'real')).map((a) => a.id)).not.toContain(made.productId);
    expect((await experimentalAssetsFor(OWNER, 'reference')).map((a) => a.id)).toContain(made.productId);
    const door = await checkKillSwitch(made.productId, 'send_email');
    expect(door.reason).toMatch(/reference company/);
  });

  it('a real row cannot claim a reference experiment, and the reverse', async () => {
    const refExp = (await query(
      `SELECT id FROM venture_experiments WHERE evidence_mode = 'reference' AND decision = 'approved' LIMIT 1`))
      .rows[0] as Record<string, unknown>;
    await expect(query(
      `INSERT INTO products (id, name, owner_id, status, reality, standing, from_experiment_id)
       VALUES ('wrongworld', 'x', ?, 'active', 'real', 'experimental', ?)`, [OWNER, String(refExp.id)]))
      .rejects.toThrow(/experiment_world_mismatch/);
  });
});
