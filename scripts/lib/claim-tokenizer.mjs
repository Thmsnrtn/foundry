// =============================================================================
// THE PORT, MADE ONE THING AND CHECKED.
//
// `scripts/audit-public-claims.mjs` carried an inline copy of the algorithm in
// `src/services/truth/engine.ts`, under a comment saying it was "kept
// dependency-free". The constraint is real — tsconfig includes only `src/**`, so
// a TypeScript module cannot be imported here and `src/` must not reach into
// `scripts/` — but the two copies had already drifted:
//
//   • the port had NO quoted-phrase handling, so a claim containing "a quoted
//     phrase" was split into words by the gate and matched whole by the engine;
//   • their stop-word lists were different sets, so different words counted as
//     significant on each side.
//
// The gate that enforces the honesty law and the module that documents it
// disagreed about what a claim says. That is the thing to fix, not the file
// count: two copies are acceptable when they are PINNED, and
// `the-gate-and-the-engine-agree.test.ts` runs both over the same inputs.
//
// `DEFAULT_STOP_WORDS` is the engine's list, verbatim — the test compares them
// word for word so the default cannot drift again.
//
// The list is also a PARAMETER, because the pricing audit wants one word the
// general engine does not drop: 'plan'. A difference that is passed in at the
// call site is a decision; a difference between two copied constants is an
// accident, and that is what this was. The measured difference before this
// change was 'plan', 'plans' — and, in the other direction, quoted phrases.
// =============================================================================

/** Words too common to carry meaning in a general claim. */
export const DEFAULT_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'that', 'this',
  'your', 'you', 'our', 'their', 'its', 'are', 'is', 'was', 'will', 'can',
  'has', 'have', 'had', 'not', 'all', 'any', 'each', 'every', 'into', 'onto',
  'than', 'then', 'when', 'what', 'who', 'how', 'why', 'where', 'while',
  'more', 'most', 'less', 'least', 'very', 'just', 'only', 'also', 'even',
  'get', 'gets', 'like', 'over', 'under', 'about', 'after', 'before',
  'costs', 'cost', 'month', 'monthly', 'include', 'includes',
]);

/**
 * Significant tokens of a claim: quoted phrases whole, numbers normalised, and
 * every remaining word of four characters or more that is not a stop word.
 */
export function tokenizeClaim(claim, stopWords = DEFAULT_STOP_WORDS) {
  const tokens = [];
  let rest = claim;

  // Quoted phrases first (matched whole, case-insensitive).
  rest = rest.replace(/"([^"]+)"/g, (_, phrase) => {
    tokens.push(phrase.toLowerCase().trim());
    return ' ';
  });

  // Numbers: strip $ , % and keep the numeric core (e.g. "$1,299/mo" → "1299").
  rest = rest.replace(/\$?\d[\d,]*(?:\.\d+)?%?/g, (num) => {
    tokens.push(num.replace(/[$,%]/g, ''));
    return ' ';
  });

  for (const word of rest.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && !stopWords.has(word)) tokens.push(word);
  }
  return [...new Set(tokens)];
}

/**
 * Verify a claim against named sources. Every token must substring-match at
 * least one source; numbers are normalised the same way on the source side.
 */
export function verifyClaim(claim, sources, stopWords = DEFAULT_STOP_WORDS) {
  const tokens = tokenizeClaim(claim, stopWords);
  const normalized = sources.map((s) => ({
    name: s.name,
    text: s.content.toLowerCase(),
    numbers: s.content.replace(/[$,%]/g, ''),
  }));

  const evidence = [];
  const unmatched = [];

  for (const token of tokens) {
    const isNumeric = /^\d[\d.]*$/.test(token);
    const hit = normalized.find((s) =>
      isNumeric ? s.numbers.includes(token) : s.text.includes(token),
    );
    if (hit) evidence.push({ token, source: hit.name });
    else unmatched.push(token);
  }
  return { verified: unmatched.length === 0, unmatchedTokens: unmatched, evidence };
}
