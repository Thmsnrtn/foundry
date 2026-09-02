process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { burdenFor, readPosture, setPosture } from '../../src/services/founder/burden.js';
import { whereTheNextDollarGoes } from '../../src/services/founder/portfolio.js';
import { establishReferenceCompany } from '../../src/services/reference/world.js';
import { recordSituation } from '../../src/services/founder/situation-chain.js';

// =============================================================================
// NOT EVERY ASSET SHOULD ALWAYS BE TRYING TO GROW.
//
// A $400-a-month asset with stable customers, an $18 bill and nobody's
// attention is not a business that failed to scale. It is a tributary, and the
// right thing to do with it may be nothing for years. And a business that pays
// $3,000 a month and needs the owner four times a week is worth less to him
// than one that pays $1,500 and needs nobody. Both of those sentences have to
// be ones the institution can say, with a stated rule behind each.
// =============================================================================

const OWNER = 'pos_owner';
const REAL = 'pos_real';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_pos', 'owner@example.com', 'Owner']);
  // A real company with numbers, so the burden sentence has money to talk about.
  await query(
    `INSERT INTO products (id, name, owner_id, status, ingest_token, ai_cost_trailing_30d_usd)
     VALUES (?, 'Real Co', ?, 'active', 'tok_pos', 12)`, [REAL, OWNER]);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents)
     VALUES ('ms_pos', ?, date('now'), 42000)`, [REAL]);
  for (const key of ['a_tributary_that_needs_nobody', 'an_anchor_that_needs_him']) {
    const made = await establishReferenceCompany({ scenarioKey: key, ownerId: OWNER });
    if (made) await recordSituation(made.productId);
  }
});

describe('hearing a posture', () => {
  const cases: Array<[string, string]> = [
    ['Leave it alone', 'hold'],
    ['Just harvest it', 'harvest'],
    ['Shut it down', 'retire'],
    ['Find it a buyer', 'sell'],
    ['Turn it into a data product', 'reposition'],
    ['Make it bigger', 'grow'],
  ];
  for (const [said, posture] of cases) {
    it(`hears "${said}" as ${posture}`, () => expect(readPosture(said)).toBe(posture));
  }
  it('does not hear an ordinary objective as a posture', () => {
    expect(readPosture('Keep the support queue answered')).toBeNull();
  });
});

describe('setting one', () => {
  it('records where it moved from and to, in his words', async () => {
    const moved = await setPosture({ productId: REAL, founderId: OWNER, to: 'harvest',
      said: 'Just harvest it' });
    expect(moved).toEqual({ from: 'grow', to: 'harvest' });
    const row = (await query('SELECT posture FROM products WHERE id = ?', [REAL]))
      .rows[0] as Record<string, unknown>;
    expect(String(row.posture)).toBe('harvest');
  });

  it('refuses any principal but the owner', async () => {
    await expect(query(
      `INSERT INTO posture_changes (id, product_id, founder_id, from_posture, to_posture, said, changed_by)
       VALUES ('pc_bad', ?, ?, 'harvest', 'retire', 'wind it down', 'system:foundry')`,
      [REAL, OWNER])).rejects.toThrow(/owner_only/);
  });

  it('keeps growth money away from a company he is harvesting', async () => {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents, new_mrr_cents, churned_mrr_cents)
       VALUES ('ms_pos_old', ?, date('now', '-35 day'), 50000, 9000, 2000)`, [REAL]);
    await query(
      `UPDATE metric_snapshots SET new_mrr_cents = 6000, churned_mrr_cents = 4000 WHERE id = 'ms_pos'`);
    await recordSituation(REAL);
    const capital = await whereTheNextDollarGoes(OWNER);
    // Whatever situation it is in, a harvested company is not a candidate for
    // growth spending: that is what the posture means.
    expect(capital.candidates.some((c) => c.productId === REAL)).toBe(false);
  });
});

describe('what a thing earns against what it costs to own', () => {
  it('says it in one sentence with the money and his attention side by side', async () => {
    const burdens = await burdenFor(OWNER);
    const real = burdens.find((b) => b.productId === REAL);
    expect(real?.sentence).toContain('earns about $420 a month');
    expect(real?.sentence).toContain('costs about $12 a month in AI');
    expect(real?.sentence).toContain('has not needed you');
    expect(real?.verdict).toBe('earning its keep');
  });

  it('never counts a reference company against his real attention', async () => {
    const burdens = await burdenFor(OWNER);
    expect(burdens.every((b) => b.productId === REAL)).toBe(true);
  });

  it('says when it costs more of him than it earns, by a stated rule', async () => {
    // Through the ask-first door, the way an interruption actually happens:
    // Foundry proposes, he decides. Four decisions in a month on a business
    // earning a few hundred dollars is the stated threshold.
    const { proposeAct, decideProposedAct, setBoundary } = await import(
      '../../src/services/institution/standing-intent.js');
    // A proposal exists only because he asked to be asked.
    await setBoundary({ productId: REAL, subject: 'contact_people', mode: 'ask_first',
      statement: 'Do not contact anyone without asking me first' });
    for (let i = 0; i < 4; i += 1) {
      const id = await proposeAct({
        productId: REAL, subject: 'contact_people', actionType: 'send_email',
        params: { to: `person${String(i)}@example.com` }, summary: 'a thing', why: 'because',
        expectedEffect: 'an effect', risk: 'low', consequence: 'low', proposedBy: 'foundry' });
      await decideProposedAct({ id, decision: 'refused', decidedBy: `founder:${OWNER}` });
    }
    const real = (await burdenFor(OWNER)).find((b) => b.productId === REAL);
    expect(real?.interruptions).toBe(4);
    expect(real?.verdict).toBe('costs more of you than it earns');
    expect(real?.sentence).toContain('needed you 4 times');
  });
});
