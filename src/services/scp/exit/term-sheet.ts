// =============================================================================
// FOUNDRY — Term Sheet Modeler
// Models fundraising round terms, computes dilution, and benchmarks via Claude.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import { callSonnet } from '../../ai/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TermSheetParams {
  round_type: string;
  investment_amount: number;
  pre_money_valuation: number;
  liquidation_preference?: string;
  anti_dilution?: string;
  pro_rata_rights?: boolean;
  board_seats?: number;
}

export interface TermSheetResult {
  id: string;
  post_money: number;
  new_dilution_pct: number;
  investor_ownership_pct: number;
  founder_retention_pct: number;
  market_context: string;
}

export interface TermSheetModel {
  id: string;
  product_id: string;
  round_type: string;
  modeled_valuation: number;
  investment_amount: number;
  pre_money_valuation: number;
  liquidation_preference: string;
  anti_dilution: string;
  pro_rata_rights: boolean;
  board_seats: number;
  post_money_valuation: number;
  new_dilution_pct: number;
  investor_ownership_pct: number;
  founder_retention_pct: number | null;
  market_context: string | null;
  created_at: string;
}

// ─── Commonly cited terms ─────────────────────────────────────────────────────
//
// THIS IS NOT MARKET DATA AND FOUNDRY HAS NONE. It is a small fixed table of
// terms commonly cited for these three rounds, written into the source. Nothing
// samples term sheets, nothing dates these ranges, and nothing revises them.
//
// It was called MARKET_BENCHMARKS and every sentence built from it said "market
// standard" — to the founder, and to the model in a prompt that then repeated
// it back as fact. Renamed for what it is, and every sentence that cites it now
// says where it came from.
//
// THERE IS NO FALLBACK ANY MORE. `?? COMMON_TERMS['seed']` meant a round type
// with no entry was told SEED's numbers under its own name: "Market standard
// for series_c: 15-25% dilution". The round type arrives from an unvalidated
// form field into a column with no CHECK constraint, so that was reachable with
// any string. A round this table does not cover now gets no comparison at all.

interface CommonTerms {
  typical_dilution_min: number;
  typical_dilution_max: number;
  standard_liq_pref: string;
  standard_anti_dilution: string;
  standard_board_seats: number;
}

const COMMON_TERMS: Record<string, CommonTerms> = {
  seed: {
    typical_dilution_min: 15,
    typical_dilution_max: 25,
    standard_liq_pref: '1x_non_participating',
    standard_anti_dilution: 'broad_based_weighted_avg',
    standard_board_seats: 1,
  },
  series_a: {
    typical_dilution_min: 20,
    typical_dilution_max: 30,
    standard_liq_pref: '1x_non_participating',
    standard_anti_dilution: 'broad_based_weighted_avg',
    standard_board_seats: 1,
  },
  series_b: {
    typical_dilution_min: 15,
    typical_dilution_max: 25,
    standard_liq_pref: '1x_non_participating',
    standard_anti_dilution: 'broad_based_weighted_avg',
    standard_board_seats: 1,
  },
};

// ─── modelTermSheet ───────────────────────────────────────────────────────────

export async function modelTermSheet(
  productId: string,
  params: TermSheetParams
): Promise<TermSheetResult> {
  const {
    round_type,
    investment_amount,
    pre_money_valuation,
    liquidation_preference = '1x_non_participating',
    anti_dilution = 'broad_based_weighted_avg',
    pro_rata_rights = true,
    board_seats = 1,
  } = params;

  const post_money = pre_money_valuation + investment_amount;
  const investor_ownership_pct = parseFloat(
    ((investment_amount / post_money) * 100).toFixed(2)
  );
  const new_dilution_pct = investor_ownership_pct;
  const founder_retention_pct = parseFloat((100 - new_dilution_pct).toFixed(2));

  const benchmark: CommonTerms | undefined = COMMON_TERMS[round_type.toLowerCase()];

  const systemPrompt = `You are a venture capital term sheet advisor. Provide concise commentary on fundraising terms.
Be direct and founder-friendly. Keep response to 2-3 sentences.
You have no market data for this round beyond what the message states. Do not cite dilution ranges, valuations, or "market standard" figures of your own — describe what these specific terms mean for this founder.`;

  const userPrompt = `Analyze these ${round_type} round terms and briefly describe how they compare to market standard:

- Pre-money valuation: $${pre_money_valuation.toLocaleString()}
- Investment: $${investment_amount.toLocaleString()}
- Post-money: $${post_money.toLocaleString()}
- Investor ownership: ${investor_ownership_pct}%
- Liquidation preference: ${liquidation_preference}
- Anti-dilution: ${anti_dilution}
- Pro-rata rights: ${pro_rata_rights ? 'Yes' : 'No'}
- Board seats: ${board_seats}

${benchmark
  ? `Terms commonly cited for a ${round_type} (a fixed reference list, not measured market data): ${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}% dilution, ${benchmark.standard_liq_pref} liquidation preference, ${benchmark.standard_board_seats} board seat(s).`
  : `No reference terms are on file for a ${round_type}. Do not compare these terms to a range.`}

Are these terms founder-friendly or investor-friendly, and why? Explain in 2-3 sentences. Say "commonly cited" rather than "market standard", and do not describe the comparison as market data.`;

  let market_context = '';
  try {
    const response = await callSonnet(systemPrompt, userPrompt, 300, productId);
    market_context = response.content;
  } catch {
    market_context = [
      `This ${round_type} round results in ${investor_ownership_pct}% dilution.`,
      benchmark
        ? `${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}% is the range commonly cited for this stage — a fixed reference, not a measurement of the current market.`
        : `Foundry has no reference terms on file for a ${round_type}, so there is nothing here to compare it against.`,
      liquidation_preference === '1x_non_participating'
        ? 'A 1x non-participating liquidation preference is the term most commonly cited as standard.'
        : 'Review the liquidation preference terms carefully.',
    ].join(' ');
  }

  const id = nanoid();

  await query(
    `INSERT INTO term_sheet_models
       (id, product_id, round_type, modeled_valuation, investment_amount,
        pre_money_valuation, liquidation_preference, anti_dilution,
        pro_rata_rights, board_seats, post_money_valuation, new_dilution_pct,
        investor_ownership_pct, founder_retention_pct, market_context)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      productId,
      round_type,
      post_money,
      investment_amount,
      pre_money_valuation,
      liquidation_preference,
      anti_dilution,
      pro_rata_rights ? 1 : 0,
      board_seats,
      post_money,
      new_dilution_pct,
      investor_ownership_pct,
      founder_retention_pct,
      market_context,
    ]
  );

  return {
    id,
    post_money,
    new_dilution_pct,
    investor_ownership_pct,
    founder_retention_pct,
    market_context,
  };
}

// ─── getTermSheetModels ───────────────────────────────────────────────────────

export async function getTermSheetModels(productId: string): Promise<TermSheetModel[]> {
  const res = await query(
    `SELECT * FROM term_sheet_models
     WHERE product_id=?
     ORDER BY created_at DESC`,
    [productId]
  );
  return res.rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      product_id: row.product_id as string,
      round_type: row.round_type as string,
      modeled_valuation: row.modeled_valuation as number,
      investment_amount: row.investment_amount as number,
      pre_money_valuation: row.pre_money_valuation as number,
      liquidation_preference: row.liquidation_preference as string,
      anti_dilution: row.anti_dilution as string,
      pro_rata_rights: (row.pro_rata_rights as number) === 1,
      board_seats: row.board_seats as number,
      post_money_valuation: row.post_money_valuation as number,
      new_dilution_pct: row.new_dilution_pct as number,
      investor_ownership_pct: row.investor_ownership_pct as number,
      founder_retention_pct: row.founder_retention_pct as number | null,
      market_context: row.market_context as string | null,
      created_at: row.created_at as string,
    };
  });
}
