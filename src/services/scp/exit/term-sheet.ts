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

export interface MarketComparison {
  assessment: 'founder_friendly' | 'market_standard' | 'investor_friendly';
  explanation: string;
  key_differences: string[];
}

// ─── Market benchmarks ────────────────────────────────────────────────────────

const MARKET_BENCHMARKS: Record<string, {
  typical_dilution_min: number;
  typical_dilution_max: number;
  standard_liq_pref: string;
  standard_anti_dilution: string;
  standard_board_seats: number;
}> = {
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

  // Generate market commentary via Claude
  const benchmark = MARKET_BENCHMARKS[round_type.toLowerCase()] ?? MARKET_BENCHMARKS['seed'];

  const systemPrompt = `You are a venture capital term sheet advisor. Provide concise, accurate market context about fundraising terms.
Be direct and founder-friendly. Keep response to 2-3 sentences.`;

  const userPrompt = `Analyze these ${round_type} round terms and briefly describe how they compare to market standard:

- Pre-money valuation: $${pre_money_valuation.toLocaleString()}
- Investment: $${investment_amount.toLocaleString()}
- Post-money: $${post_money.toLocaleString()}
- Investor ownership: ${investor_ownership_pct}%
- Liquidation preference: ${liquidation_preference}
- Anti-dilution: ${anti_dilution}
- Pro-rata rights: ${pro_rata_rights ? 'Yes' : 'No'}
- Board seats: ${board_seats}

Market standard for ${round_type}: ${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}% dilution, ${benchmark.standard_liq_pref} liquidation preference, ${benchmark.standard_board_seats} board seat(s).

Is this founder-friendly, market standard, or investor-friendly? Explain in 2-3 sentences.`;

  let market_context = '';
  try {
    const response = await callSonnet(systemPrompt, userPrompt, 300, productId);
    market_context = response.content;
  } catch {
    market_context = `This ${round_type} round results in ${investor_ownership_pct}% dilution. Market standard for this stage is ${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}%. ${liquidation_preference === '1x_non_participating' ? 'The 1x non-participating liquidation preference is market standard.' : 'Review liquidation preference terms carefully.'}`;
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

// ─── compareToMarketTerms ─────────────────────────────────────────────────────

export async function compareToMarketTerms(
  productId: string,
  modelId: string
): Promise<MarketComparison> {
  const res = await query(
    'SELECT * FROM term_sheet_models WHERE id=? AND product_id=?',
    [modelId, productId]
  );

  if (res.rows.length === 0) {
    return {
      assessment: 'market_standard',
      explanation: 'Term sheet not found.',
      key_differences: [],
    };
  }

  const model = res.rows[0] as Record<string, unknown>;
  const roundType = (model.round_type as string).toLowerCase();
  const benchmark = MARKET_BENCHMARKS[roundType] ?? MARKET_BENCHMARKS['seed'];
  const dilution = model.new_dilution_pct as number;
  const liqPref = model.liquidation_preference as string;
  const antiDilution = model.anti_dilution as string;
  const boardSeats = model.board_seats as number;

  const differences: string[] = [];

  // Dilution assessment
  if (dilution < benchmark.typical_dilution_min - 3) {
    differences.push(`Dilution (${dilution}%) is below market range of ${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}% — very founder-friendly`);
  } else if (dilution > benchmark.typical_dilution_max + 3) {
    differences.push(`Dilution (${dilution}%) exceeds typical ${roundType} range of ${benchmark.typical_dilution_min}-${benchmark.typical_dilution_max}%`);
  }

  // Liquidation preference
  if (liqPref.includes('participating')) {
    differences.push('Participating preferred is investor-friendly — converts to a tax on your exit proceeds');
  } else if (liqPref === '1x_non_participating') {
    differences.push('1x non-participating is market standard and founder-friendly');
  } else if (liqPref.includes('2x') || liqPref.includes('3x')) {
    differences.push(`${liqPref} liquidation preference is above market — pushes proceeds to investors before founders see returns`);
  }

  // Anti-dilution
  if (antiDilution === 'full_ratchet') {
    differences.push('Full ratchet anti-dilution is rare and heavily investor-friendly — negotiate to broad-based weighted average');
  } else if (antiDilution === 'broad_based_weighted_avg') {
    differences.push('Broad-based weighted average anti-dilution is market standard');
  }

  // Board seats
  if (boardSeats > benchmark.standard_board_seats) {
    differences.push(`${boardSeats} board seat(s) for a ${roundType} is above standard (typically ${benchmark.standard_board_seats})`);
  }

  // Determine overall assessment
  let investorFriendlyCount = 0;
  let founderFriendlyCount = 0;

  if (dilution > benchmark.typical_dilution_max) investorFriendlyCount++;
  if (dilution < benchmark.typical_dilution_min) founderFriendlyCount++;
  if (liqPref.includes('participating') || liqPref.includes('2x')) investorFriendlyCount++;
  if (liqPref === '1x_non_participating') founderFriendlyCount++;
  if (antiDilution === 'full_ratchet') investorFriendlyCount++;
  if (boardSeats > benchmark.standard_board_seats) investorFriendlyCount++;

  let assessment: 'founder_friendly' | 'market_standard' | 'investor_friendly';
  if (founderFriendlyCount > investorFriendlyCount) {
    assessment = 'founder_friendly';
  } else if (investorFriendlyCount > founderFriendlyCount) {
    assessment = 'investor_friendly';
  } else {
    assessment = 'market_standard';
  }

  const explanation =
    assessment === 'founder_friendly'
      ? `These ${roundType} terms are founder-friendly — dilution is within or below market range and key protective provisions are reasonable.`
      : assessment === 'investor_friendly'
      ? `These ${roundType} terms lean investor-friendly — one or more provisions (liquidation preference, anti-dilution, or dilution) are above market standard for this stage.`
      : `These ${roundType} terms are broadly market standard for this stage.`;

  return {
    assessment,
    explanation,
    key_differences: differences.length > 0 ? differences : ['Terms are broadly in line with market standard.'],
  };
}
