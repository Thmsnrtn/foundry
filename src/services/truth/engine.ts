// =============================================================================
// FOUNDRY — Truth engine (Ascent A3 / Honesty Law, adapted from AcreOS)
//
// Deterministic, offline claim verification: a claim is VERIFIED only if every
// significant token (all numbers, quoted phrases, meaningful words) matches at
// least one NAMED source. Forgiving on phrasing, strict on numbers — a claim
// citing "$79/mo" is unverifiable unless a source actually contains 79.
//
// Uses: (1) auditing public copy against code-derived sources in CI, so the
// landing page can't drift from what the product actually is; (2) grounding
// generated briefing claims against telemetry. The engine is the floor, not
// the ceiling — human review still applies.
// =============================================================================

export interface Source {
  name: string;      // where this truth comes from (e.g. 'billing constants')
  content: string;   // the text/values that ground claims
}

export interface Verification {
  verified: boolean;
  unmatchedTokens: string[];
  evidence: Array<{ token: string; source: string }>;
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'with', 'from', 'that', 'this',
  'your', 'you', 'our', 'their', 'its', 'are', 'is', 'was', 'will', 'can',
  'has', 'have', 'had', 'not', 'all', 'any', 'each', 'every', 'into', 'onto',
  'than', 'then', 'when', 'what', 'who', 'how', 'why', 'where', 'while',
  'more', 'most', 'less', 'least', 'very', 'just', 'only', 'also', 'even',
  'get', 'gets', 'like', 'over', 'under', 'about', 'after', 'before',
  'costs', 'cost', 'month', 'monthly', 'include', 'includes',
]);

/** Extract the tokens that carry a claim's factual weight:
 *  - every number (with or without $ / % / commas) — always significant
 *  - every "quoted phrase" — matched whole
 *  - every remaining word of ≥4 chars that isn't a stop word */
export function tokenizeClaim(claim: string): string[] {
  const tokens: string[] = [];
  let rest = claim;

  // Quoted phrases first (matched whole, case-insensitive).
  rest = rest.replace(/"([^"]+)"/g, (_, phrase: string) => {
    tokens.push(phrase.toLowerCase().trim());
    return ' ';
  });

  // Numbers: strip $ , % and keep the numeric core (e.g. "$1,299/mo" → "1299").
  rest = rest.replace(/\$?\d[\d,]*(?:\.\d+)?%?/g, (num: string) => {
    tokens.push(num.replace(/[$,%]/g, ''));
    return ' ';
  });

  for (const word of rest.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 4 && !STOP_WORDS.has(word)) tokens.push(word);
  }
  return [...new Set(tokens)];
}

/** Verify a claim against named sources. Every token must substring-match at
 *  least one source (numbers are normalized the same way on the source side). */
export function verifyClaim(claim: string, sources: Source[]): Verification {
  const tokens = tokenizeClaim(claim);
  const normalized = sources.map((s) => ({
    name: s.name,
    text: s.content.toLowerCase(),
    numbers: s.content.replace(/[$,%]/g, ''),
  }));

  const evidence: Verification['evidence'] = [];
  const unmatched: string[] = [];

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

/** Convenience: verify a batch, returning only the failures (for CI audits). */
export function auditClaims(
  claims: string[],
  sources: Source[],
): Array<{ claim: string; unmatchedTokens: string[] }> {
  return claims
    .map((claim) => ({ claim, result: verifyClaim(claim, sources) }))
    .filter(({ result }) => !result.verified)
    .map(({ claim, result }) => ({ claim, unmatchedTokens: result.unmatchedTokens }));
}
