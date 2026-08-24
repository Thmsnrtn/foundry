process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// =============================================================================
// FOUR FLAGS THAT WERE ALWAYS FALSE, IN AN ASSESSMENT OF WHETHER TO RAISE.
//
// `fundraising-readiness` read `product_dna.target_customer`, `.competitors`,
// `.positioning`, `.core_hypothesis` and `.hypothesis_validated`. None of the
// five has ever been a column. Off a `SELECT *` row they are `undefined`, so
// `has_icp_defined`, `has_competitive_section`, `has_positioning` and
// `has_hypothesis_tested` were FALSE for every company that has ever run this —
// six of the ten points on the narrative dimension and two on traction,
// withheld from everybody.
//
// The real fields are `icp_description`, `competitive_landscape` and
// `positioning_statement`. There is no hypothesis on the DNA: a tested
// hypothesis is one that reached a terminal status in the `hypotheses` table.
// =============================================================================

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: async () => ({ content: '{"gaps":[]}', input_tokens: 1, output_tokens: 1 }),
  };
});

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { assessFundraisingReadiness } = await import('../../src/services/scp/investor/fundraising-readiness.js');

const P = 'p_flags';
const LONG = 'A sentence long enough to count as filled in, well past twenty characters.';

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_flags','c_flags','f@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,'Acme','f_flags','active')", [P]);
});

beforeEach(async () => {
  await query('DELETE FROM product_dna');
  await query('DELETE FROM hypotheses');
  await query('DELETE FROM fundraising_scores');
});

/** The three DNA flags are scored on the MARKET dimension; the tested
 *  hypothesis is scored on NARRATIVE. */
async function marketScore(): Promise<number> {
  const r = await assessFundraisingReadiness(P, 'seed');
  return r.scores.market;
}

describe('the market dimension', () => {
  it('scores a company that has filled its DNA in', async () => {
    await query(
      `INSERT INTO product_dna (id, product_id, icp_description, competitive_landscape, positioning_statement)
       VALUES ('dna_1', ?, ?, ?, ?)`, [P, LONG, LONG, LONG]);

    const withDna = await marketScore();
    expect(withDna, 'all six points were withheld from every company').toBe(10);
  });

  it('scores nothing when the DNA is empty', async () => {
    await query("INSERT INTO product_dna (id, product_id) VALUES ('dna_2', ?)", [P]);
    expect(await marketScore()).toBe(0);
  });

  it('does not count a one-word answer as a positioning statement', async () => {
    await query(
      `INSERT INTO product_dna (id, product_id, icp_description, competitive_landscape, positioning_statement)
       VALUES ('dna_3', ?, 'devs', 'none', 'fast')`, [P]);
    expect(await marketScore()).toBe(0);
  });
});

describe('a tested hypothesis', () => {
  /** Two of the eight narrative points; nothing else in this fixture scores. */
  async function narrativeCountsIt(): Promise<boolean> {
    const r = await assessFundraisingReadiness(P, 'seed');
    return r.scores.narrative > 0;
  }

  it('counts one that reached a terminal status, including a failure', async () => {
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('h_1', ?, 'oracle', 'Weekly digests lift retention', 'disproven')`, [P]);
    expect(await narrativeCountsIt()).toBe(true);
  });

  it('does not count one that is still being tested', async () => {
    await query(
      `INSERT INTO hypotheses (id, product_id, proposed_by, statement, status)
       VALUES ('h_2', ?, 'oracle', 'Still running', 'active')`, [P]);
    expect(await narrativeCountsIt()).toBe(false);
  });
});
