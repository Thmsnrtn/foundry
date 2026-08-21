// =============================================================================
// FOUNDRY — saying "unknown" to a model, instead of saying zero
//
// Four agents read a company's `metric_snapshots` and put the numbers into a
// prompt. When a company had reported nothing, every one of them wrote:
//
//     const churnRate = metrics ? (Number(metrics.churn_rate) || 0) * 100 : 0;
//
// and the prompt read `Churn rate: 0.0%. NPS: 0.0.` — which is not an absence
// of data, it is a claim of excellent retention and a mediocre NPS. Harbor's
// system prompt then says, in these words, "You do not hedge when customer data
// is clear", and asks for named accounts and specific dollar amounts.
//
// So the failure was not that a reader might misread a zero. It was that a
// model was handed fabricated facts under an instruction to be confident, and
// its output reaches a founder as advice about their company.
//
// THE RULE ALREADY EXISTED. `jobs/index.ts` writes
// `m.activation_rate != null ? … : 'unknown'` for the same columns, in a prompt
// built from the same table, for the same reader. One rule, two implementations,
// and the wrong one was in four files. It is stated once here.
//
// NULL AND ZERO ARE DIFFERENT ANSWERS and only these helpers may decide which
// a prompt gets. `0` reaching a prompt through them means a snapshot really
// recorded zero — which is a finding, and should read like one.
// =============================================================================

/** What a prompt says where a number is not known. One word, everywhere. */
export const UNKNOWN = 'unknown';

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A stored fraction (0..1) as a percentage — `activation_rate`, `churn_rate`,
 * `day_30_retention`, `mrr_health_ratio`.
 */
export function pctOfFraction(value: unknown, digits = 1): string {
  const n = num(value);
  return n === null ? UNKNOWN : `${(n * 100).toFixed(digits)}%`;
}

/** A number stored on its own scale — NPS, a score, a count of things. */
export function measured(value: unknown, digits = 0): string {
  const n = num(value);
  return n === null ? UNKNOWN : n.toFixed(digits);
}

/** Cents as dollars. `$0.00` is a real amount; nothing recorded is not. */
export function money(cents: unknown): string {
  const n = num(cents);
  return n === null ? UNKNOWN : `$${(n / 100).toFixed(2)}`;
}

/**
 * A ratio a caller computes itself, where the denominator may be empty.
 *
 * The reason this exists rather than being written inline each time: every
 * inline version of it in this repository chose a fallback — 100 in one place,
 * 0 in another — and which one flatters is an accident of which digit was
 * typed. There is no correct fallback. There is only `unknown`.
 */
export function rate(numerator: number, denominator: number, digits = 1): string {
  if (!Number.isFinite(denominator) || denominator <= 0) return UNKNOWN;
  return `${((numerator / denominator) * 100).toFixed(digits)}%`;
}
