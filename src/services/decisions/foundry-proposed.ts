// =============================================================================
// FOUNDRY — was this decision a test of FOUNDRY'S judgement?
//
// Three places ask the same question and every one of them decides how much
// authority Foundry gets, or tells the founder how much it has earned:
//
//   • the autopilot ladder, banking a clean cycle toward leaving `shadow`
//   • the shadow ledger, printing an agreement rate into the operator letter
//   • the trust ledger, PROPOSING that a category graduate a gate
//
// The answer has to be the same in all three, and it was not. Each carried its
// own copy: the autopilot ladder in TypeScript, the shadow ledger in SQL, the
// trust ledger not at all — it filtered on `decided_by = 'founder'`, which says
// who RESOLVED the row, not who proposed it. A founder who dictates their own
// strategic calls into Ask Foundry or the mobile app, resolves them, and
// records good outcomes crossed the bar on their OWN judgment and was told
// Foundry had earned the gate.
//
// Two copies are fine when they are pinned. Three copies, one of them absent,
// is one rule with three answers — so the rule is written once, here, and the
// TypeScript form is asserted against the SQL form by test.
//
// THE RULE: Foundry's judgement was tested when Foundry named an option and the
// founder took THAT option, or when Foundry decided it itself. A decision
// carrying no recommendation tested nothing of Foundry's. Compared
// case-insensitively and whitespace-trimmed, because a recommendation and a
// choice are free text written by two different code paths.
//
// A whitespace-only recommendation is NOT a view, and `TRIM(LOWER('  ')) =
// TRIM(LOWER(''))` is true — which is how a decision where Foundry said nothing
// and the founder chose nothing was once counted as agreement.
// =============================================================================

/**
 * The SQL predicate, for a query that has `decisions` in scope under the alias
 * given. Written as a fragment rather than a whole clause so callers keep their
 * own WHERE readable.
 */
export function foundryJudgementTestedSql(alias = ''): string {
  const c = alias ? `${alias}.` : '';
  return `(${c}decided_by = 'second_self' OR (${c}recommendation IS NOT NULL`
    + ` AND TRIM(${c}recommendation) != ''`
    + ` AND TRIM(LOWER(${c}chosen_option)) = TRIM(LOWER(${c}recommendation))))`;
}

/** The same rule over a row already loaded. */
export function foundryJudgementWasTested(row: {
  decided_by?: unknown; recommendation?: unknown; chosen_option?: unknown;
}): boolean {
  if (row.decided_by === 'second_self') return true;
  const recommended = typeof row.recommendation === 'string'
    ? row.recommendation.trim().toLowerCase() : '';
  const chosen = typeof row.chosen_option === 'string'
    ? row.chosen_option.trim().toLowerCase() : '';
  return recommended.length > 0 && recommended === chosen;
}
