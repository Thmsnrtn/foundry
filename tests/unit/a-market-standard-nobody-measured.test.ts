process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A "MARKET STANDARD" NOBODY MEASURED, FOR A ROUND NOBODY LISTED.
//
// `MARKET_BENCHMARKS` is five numbers per round written into the source. It is
// not sampled, not dated, and not revised — and every sentence built from it
// said "market standard", to the founder and to the model in a prompt that then
// repeated it back as fact.
//
// The sharper half: `MARKET_BENCHMARKS[round_type] ?? MARKET_BENCHMARKS['seed']`
// meant a round type with no entry got SEED's numbers under its own name. The
// round type arrives from an unvalidated form field into a column with no CHECK
// constraint, so "Market standard for series_c: 15-25% dilution" — a fabricated
// fact about a named round — was one form submission away.
// =============================================================================

const behaviour: { content: string; throws: boolean; lastUserPrompt: string } = {
  content: 'commentary', throws: false, lastUserPrompt: '',
};

vi.mock('../../src/services/ai/client.js', async (orig) => {
  const actual = await orig<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: async (_system: string, user: string) => {
      behaviour.lastUserPrompt = user;
      if (behaviour.throws) throw new Error('model unavailable');
      return { content: behaviour.content, input_tokens: 1, output_tokens: 1 };
    },
  };
});

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { modelTermSheet } = await import('../../src/services/scp/exit/term-sheet.js');

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_ts','c_ts','ts@example.com')");
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_ts','Acme','f_ts','active')");
});

beforeEach(() => {
  behaviour.content = 'commentary';
  behaviour.throws = false;
  behaviour.lastUserPrompt = '';
});

const TERMS = {
  investment_amount: 2_000_000,
  pre_money_valuation: 8_000_000,
  liquidation_preference: '1x_non_participating',
  anti_dilution: 'broad_based_weighted_avg',
  pro_rata_rights: true,
  board_seats: 1,
};

describe('a round the reference list does not cover', () => {
  it('is not quietly given seed’s numbers', async () => {
    await modelTermSheet('p_ts', { ...TERMS, round_type: 'series_c' });
    expect(behaviour.lastUserPrompt).not.toContain('15-25%');
    expect(behaviour.lastUserPrompt).toContain('No reference terms are on file');
  });

  it('says so in the text stored when the model is unavailable', async () => {
    behaviour.throws = true;
    const result = await modelTermSheet('p_ts', { ...TERMS, round_type: 'series_c' });
    expect(result.market_context).toContain('no reference terms on file');
    expect(result.market_context).not.toContain('15-25%');

    // By id: `created_at` has second granularity, so two rows written in the
    // same second order arbitrarily, and this test read the other one.
    const row = (await query(
      'SELECT market_context FROM term_sheet_models WHERE id=?', [result.id],
    )).rows[0] as unknown as Record<string, unknown>;
    expect(String(row.market_context)).toContain('no reference terms on file');
  });
});

describe('a round it does cover', () => {
  it('states the range as commonly cited rather than as measured market data', async () => {
    await modelTermSheet('p_ts', { ...TERMS, round_type: 'seed' });
    expect(behaviour.lastUserPrompt).toContain('15-25%');
    expect(behaviour.lastUserPrompt).toContain('not measured market data');
    expect(behaviour.lastUserPrompt).not.toContain('Market standard for');
  });

  it('does not put a market claim in the fallback text either', async () => {
    behaviour.throws = true;
    const result = await modelTermSheet('p_ts', { ...TERMS, round_type: 'seed' });
    expect(result.market_context).toContain('commonly cited');
    expect(result.market_context).toContain('not a measurement of the current market');
    expect(result.market_context).not.toContain('Market standard');
  });
});

describe('the source', () => {
  const src = stripComments(readFileSync('src/services/scp/exit/term-sheet.ts', 'utf8'));

  it('has no silent fallback to another round’s terms', () => {
    expect(src).not.toMatch(/COMMON_TERMS\[[^\]]*\]\s*\?\?/);
  });

  it('no longer exports a market comparison nothing reached', () => {
    // `compareToMarketTerms` was imported by the exit dashboard and never
    // called. It built the same unsourced sentences — "below market range",
    // "above market standard" — from the same fixed table, and it carried the
    // same fallback to seed's numbers.
    expect(src).not.toContain('compareToMarketTerms');
    const page = stripComments(readFileSync('src/routes/dashboard/exit.ts', 'utf8'));
    expect(page).not.toContain('compareToMarketTerms');
  });

  it('does not tell the model to supply market figures of its own', () => {
    expect(src).toContain('Do not cite dilution ranges');
  });
});
