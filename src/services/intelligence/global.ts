// =============================================================================
// FOUNDRY — Global Founder Support
// PPP adjustments, currency tracking, geopolitical risk scanning.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

// PPP factors relative to USD (approximate, updated periodically)
const PPP_FACTORS: Record<string, number> = {
  US: 1.0, GB: 0.85, CA: 0.90, AU: 0.88, DE: 0.82, FR: 0.83,
  JP: 0.65, KR: 0.55, IN: 0.25, BR: 0.35, MX: 0.40, NG: 0.20,
  KE: 0.22, GH: 0.18, ZA: 0.35, PH: 0.28, VN: 0.22, ID: 0.25,
  TH: 0.30, PL: 0.45, CZ: 0.50, RO: 0.38, TR: 0.25, AR: 0.20,
  CO: 0.30, CL: 0.40, PE: 0.30, EG: 0.20, PK: 0.18, BD: 0.18,
  SG: 0.80, HK: 0.75, IL: 0.78, AE: 0.75, SE: 0.85, NL: 0.82,
  CH: 1.05, NO: 0.90, DK: 0.85, FI: 0.82, IE: 0.82, NZ: 0.85,
  PT: 0.65, ES: 0.70, IT: 0.72, BE: 0.80, AT: 0.80, TW: 0.55,
  CN: 0.35, RU: 0.30, UA: 0.22, MY: 0.30,
};

/**
 * Get PPP factor for a country code.
 */
export function getPPPFactor(countryCode: string): number {
  return PPP_FACTORS[countryCode.toUpperCase()] ?? 1.0;
}

/**
 * Adjust financial stressor thresholds by PPP factor.
 */
export function adjustThresholds(
  thresholds: Record<string, number>,
  pppFactor: number
): Record<string, number> {
  const adjusted: Record<string, number> = {};
  for (const [key, value] of Object.entries(thresholds)) {
    adjusted[key] = value * pppFactor;
  }
  return adjusted;
}

/**
 * Convert a local currency amount to USD reference.
 */
export function convertToReferenceCurrency(amount: number, exchangeRate: number): number {
  if (exchangeRate <= 0) return amount;
  return amount / exchangeRate;
}

// `detectCurrencyErosion` was here, and it reported FX erosion on the live
// `GET /api/currency-health` endpoint for a phenomenon it could not observe.
//
// It compared the trend of `local_currency_mrr` against the trend of
// `new_mrr_cents`. Three things were wrong with that, and each alone would have
// been enough:
//
//   NOTHING CAN FILL THE CURRENCY COLUMNS. `local_currency_mrr` and
//   `exchange_rate` were added by migration 011 and no path writes either — no
//   ingest field, no integration, no route, no job. A company has no way to
//   report the local-currency figure this detector is about.
//
//   SO THE FALLBACK WAS THE WHOLE INPUT. `?? 0` on both sides made
//   `localChange` zero, which reads as 'flat', and flat-local against
//   declining-USD is exactly the erosion condition. The detector fired whenever
//   the USD series fell.
//
//   AND THE USD SERIES WAS THE WRONG QUANTITY. `new_mrr_cents` is one period's
//   new business; `local_currency_mrr` is a level. Their trends are not
//   comparable even when both are present.
//
// Removed rather than repaired, on the owner decision recorded at migration 157:
// the consuming half goes, and if currency exposure is genuinely wanted it comes
// back as a whole feature — an ingest field a company can actually fill, a
// stored rate, and a comparison between two series of the same kind. Migration
// 193 drops the two columns nothing could write.

/**
 * Scan for geopolitical risks affecting a product's markets.
 */
export async function scanGeopoliticalRisks(
  productId: string,
  ownerId: string
): Promise<Array<{
  signal_type: string;
  severity: string;
  description: string;
  affected_markets: string[];
}>> {
  const product = await query('SELECT name, market_category, sector_profile FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, string> | undefined;
  if (!p) return [];

  const founder = await query('SELECT country_code FROM founders WHERE id = ?', [ownerId]);
  const f = founder.rows[0] as Record<string, string> | undefined;

  const prompt = `Identify current (as of April 2026) geopolitical risks for a ${p.sector_profile ?? 'b2b_saas'} SaaS product in the ${p.market_category ?? 'general'} category.

Founder based in: ${f?.country_code ?? 'US'}
Product: ${p.name}

Consider: regulatory changes, trade restrictions, political shifts, currency crises, sanctions.

Return JSON array:
[{"signal_type": "regulatory_change|trade_restriction|political_shift|currency_crisis|sanctions", "severity": "low|medium|high|critical", "description": "...", "affected_markets": ["US", "EU"]}]

Only include real, current risks. Return empty array if none are relevant.`;

  const response = await callSonnet(
    'You are a geopolitical risk analyst for SaaS businesses. Only flag real, current risks.',
    prompt,
    2048, productId
  );

  const signals = parseJSONResponse<Array<{
    signal_type: string;
    severity: string;
    description: string;
    affected_markets: string[];
  }>>(response.content);

  // Persist
  for (const signal of signals) {
    await query(
      `INSERT INTO geopolitical_signals (id, product_id, owner_id, signal_type, severity, description, affected_markets, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ai_scan')`,
      [nanoid(), productId, ownerId, signal.signal_type, signal.severity, signal.description, JSON.stringify(signal.affected_markets)]
    );
  }

  return signals;
}

/**
 * Recommend optimal schedule blocks based on timezone overlap.
 */
export function getTimezoneOptimalSchedule(
  founderTimezone: string,
  customerTimezones: string[]
): {
  build_block: string;
  support_block: string;
  decide_block: string;
} {
  // Simple heuristic: build early morning, support during overlap, decide afternoon
  // Real implementation would use timezone offset calculations
  return {
    build_block: '6:00 AM - 10:00 AM (founder local) — deep work before customers wake',
    support_block: '10:00 AM - 2:00 PM (founder local) — maximum timezone overlap with customers',
    decide_block: '2:00 PM - 4:00 PM (founder local) — review decisions after daily context',
  };
}
