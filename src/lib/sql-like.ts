// =============================================================================
// FOUNDRY — a LIKE pattern that means what the caller said
//
// `LIKE '%' || value || '%'` treats `%` and `_` INSIDE the value as wildcards,
// so a value that contains one matches things the caller never asked for. The
// query is parameterised and there is no SQL injection here; the injection is
// into the PATTERN, and the consequence is that the row acted on is not the row
// the caller meant.
//
// It reached a write. `POST /api/ask` classifies a founder's message with a
// model, and a `resolve_stressor` action takes the `stressor_name` the model
// extracted straight into `LIKE '%' || name || '%' LIMIT 1` — then marks the
// single row it finds resolved. A message that gets the model to answer `%`
// matches the company's FIRST ACTIVE STRESSOR, whatever it is, and resolves it.
// Neither the founder nor the model has to intend that: `%` is a character
// people type, and "resolve the 20% churn stressor" carries one.
//
// Every caller here is searching for a SUBSTRING a person or a model named. So
// the wildcards belong to the query, not to the value, and the value is escaped
// before it becomes part of the pattern.
// =============================================================================

/** The escape character named by `LIKE ? ESCAPE '\'` in the queries below. */
const ESCAPE_CHAR = '\\';

/**
 * A `%value%` pattern in which the value's own `%`, `_` and `\` are literal.
 *
 * Pair it with `ESCAPE '\'` in the SQL — `LIKE ? ESCAPE '\'` — or the escapes
 * are matched as characters and the pattern is wrong in the other direction.
 */
export function likeContains(value: string): string {
  return `%${escapeLikeValue(value)}%`;
}

/** The same escaping without the surrounding wildcards, for prefix matches. */
export function escapeLikeValue(value: string): string {
  return value
    .replaceAll(ESCAPE_CHAR, ESCAPE_CHAR + ESCAPE_CHAR)
    .replaceAll('%', ESCAPE_CHAR + '%')
    .replaceAll('_', ESCAPE_CHAR + '_');
}

/** The `ESCAPE` clause the patterns above require, so the two cannot drift. */
export const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\'";
