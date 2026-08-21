process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// The slides are written by a model; this test is about what it is given.
const seen: Array<{ system: string; user: string }> = [];
vi.mock('../../src/services/ai/client.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  callOpus: vi.fn(async (system: string, user: string) => {
    seen.push({ system, user });
    return { content: JSON.stringify({ slides: ['s1', 's2'] }), tokensUsed: 1, costUsd: 0 };
  }),
}));

const { generateBoardDeck } = await import('../../src/services/investor/automation.js');

// =============================================================================
// A BOARD DECK OF INVENTED NUMBERS.
//
// `POST /api/products/:id/board-deck` is mounted and authenticated. It asked a
// model for eight slides including "Key Metrics (MRR, growth, churn, NPS)",
// "Customer Health (cohort trends, churn analysis)" and "Financial Overview
// (runway, unit economics)" — and passed it the company's NAME, SECTOR AND
// STAGE. Nothing else. No metric, no customer, no runway.
//
// So every number on those slides was invented, by a model instructed to be
// "data-focused", in a document a founder takes to their investors.
//
// Of every claim-without-evidence found in this campaign this one has the
// furthest reach. The others mislead the founder. This one is handed onward BY
// the founder to people deciding whether to fund them.
//
// The company's real figures are passed now, through `ai/measured.ts`, which
// says `unknown` rather than letting a fallback become a fact — and the system
// prompt says unknown must survive to the slide, because a model asked for a
// board deck will write a plausible number over a gap without being asked to.
// =============================================================================

beforeAll(async () => { await runMigrations(); });
beforeEach(async () => {
  seen.length = 0;
  await query('DELETE FROM competitors');
  await query('DELETE FROM metric_snapshots');
  await query('DELETE FROM customers');
  await query('DELETE FROM company_financial_position');
  await query('DELETE FROM products');
  await query('DELETE FROM founders');
});

async function company(): Promise<{ productId: string; ownerId: string }> {
  const ownerId = `f_${nanoid(8)}`;
  await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
    [ownerId, `c_${ownerId}`, `${ownerId}@example.com`]);
  const productId = `p_${nanoid(8)}`;
  await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
    [productId, 'Acme', ownerId]);
  return { productId, ownerId };
}

describe('a company that has reported nothing', () => {
  it('tells the model so, rather than leaving it to guess', async () => {
    const { productId, ownerId } = await company();
    await generateBoardDeck(productId, ownerId);

    const { user } = seen[0]!;
    expect(user).toMatch(/no metric snapshot has ever been reported/);
    expect(user, 'unknown, not a zero standing in for one').toMatch(/MRR: unknown/);
    expect(user).toMatch(/Churn rate: unknown/);
    expect(user).toMatch(/NPS: unknown/);
    expect(user).toMatch(/runway cannot be computed/);
  });

  it('forbids inventing one, in the system prompt', async () => {
    const { productId, ownerId } = await company();
    await generateBoardDeck(productId, ownerId);

    const { system } = seen[0]!;
    expect(system).toMatch(/EVERY NUMBER YOU WRITE MUST COME FROM THE REPORTED FIGURES/);
    expect(system).toMatch(/do\s+NOT estimate, interpolate, illustrate or use a placeholder/);
    expect(system, 'the reason, so it is not trimmed as boilerplate')
      .toMatch(/people deciding whether to fund them/);
    expect(system, 'prose is still allowed — the constraint is on facts')
      .toMatch(/may be written freely/);
  });
});

describe('a company that has reported figures', () => {
  it('passes its own numbers, not a description of its sector', async () => {
    const { productId, ownerId } = await company();
    await query(
      `INSERT INTO metric_snapshots
         (id, product_id, snapshot_date, mrr_cents, churn_rate, nps_score, active_users)
       VALUES (?,?, date('now'), 4200000, 0.021, 47, 830)`, [nanoid(), productId]);
    await query(
      `INSERT INTO company_financial_position
         (product_id, cash_on_hand_cents, monthly_burn_cents, as_of_date, stated_by)
       VALUES (?, 18000000, 2200000, date('now'), ?)`, [productId, ownerId]);
    await query("INSERT INTO competitors (id, product_id, name) VALUES (?,?,'Rival Inc')",
      [nanoid(), productId]);

    await generateBoardDeck(productId, ownerId);
    const { user } = seen[0]!;
    expect(user).toMatch(/MRR: \$42000\.00/);
    expect(user, 'a fraction rendered as the percentage it is').toMatch(/Churn rate: 2\.1%/);
    expect(user).toMatch(/NPS: 47\.0/);
    expect(user).toMatch(/Active users: 830/);
    expect(user).toMatch(/Cash on hand: \$180000\.00/);
    expect(user).toMatch(/Rival Inc/);
  });

  it('counts customers and says which are in trouble', async () => {
    const { productId, ownerId } = await company();
    for (const risk of [0.9, 0.1]) {
      await query(
        `INSERT INTO customers (id, product_id, owner_id, email, health_score, churn_risk)
         VALUES (?,?,?,?,?,?)`,
        [nanoid(), productId, ownerId, `${nanoid(6)}@example.com`, 50, risk]);
    }
    await generateBoardDeck(productId, ownerId);
    const { user } = seen[0]!;
    expect(user).toMatch(/Customers on record: 2/);
    expect(user).toMatch(/Customers currently at risk: 1/);
  });

  it('says none rather than omitting the line when there are no competitors', async () => {
    const { productId, ownerId } = await company();
    await generateBoardDeck(productId, ownerId);
    expect(seen[0]!.user).toMatch(/Competitors on record: none/);
  });
});

describe('the shape of the fix', () => {
  it('passes figures through the one place that decides unknown', () => {
    const src = stripComments(
      readFileSync('src/services/investor/automation.ts', 'utf8'), { lineComments: true });
    expect(src).toMatch(/import\('\.\.\/ai\/measured\.js'\)/);
    expect(src, 'the prompt used to carry name, sector and stage and nothing else')
      .toMatch(/THE COMPANY'S REPORTED FIGURES/);
  });

  it('still records the deck, and says why the row staying unread is fine', () => {
    const src = readFileSync('src/services/investor/automation.ts', 'utf8');
    expect(src).toMatch(/INSERT INTO board_decks/);
    expect(src).toMatch(/stays on the unread-tables baseline/);
    expect(readFileSync('docs/db/unread-tables-baseline.txt', 'utf8'))
      .toMatch(/board_decks/);
  });
});
