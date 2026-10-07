// =============================================================================
// FOUNDRY — a number the record does not hold is a number somebody invented
//
// Every prompt the venture loop sends says it in the same words: the model may
// create readings, questions and designs; it may not create counts, prices,
// usage figures or market sizes, and it may never write a number that is not
// in the record in front of it. Said, and until now not checked: a reader
// could write "about 40,000 people a month search for this" about a post that
// gave no number, and a discipline could find that "this file sold 312 copies
// last month", and both were stored as the institution's own reading.
//
// This is the check, in one place, for every reader of the record: each
// number a model wrote must appear in the text it was given. A number is
// compared by its digits ("40,000" and "40000" are one number), and an amount
// the record holds in cents is the same amount in dollars. A small bare count
// (twelve or fewer, with no % or $) is how a reader counts the record's own
// parts — "two readings", "3 posts" — and is not treated as a fact about the
// world; a percentage or a price of any size is. What fails is quoted with
// the words around it, so the refusal says what was refused.
// =============================================================================

const NUMBER = /(\$\s?)?\d[\d,]*(?:\.\d+)?(\s?%)?/g;
const norm = (s: string): string => s.replace(/[,$%\s]/g, '').replace(/\.0+$/, '');

/** Every number in `texts` that `source` does not contain, each quoted with the words around it. Empty when every number is the record's. */
export function numbersNotIn(source: string, texts: Array<string | null | undefined>): string[] {
  const held = new Set<string>();
  for (const m of source.matchAll(NUMBER)) {
    const n = norm(m[0]);
    held.add(n);
    const v = Number(n);
    if (Number.isInteger(v) && v % 100 === 0 && v >= 100) held.add(String(v / 100));
  }
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(NUMBER)) {
      const n = norm(m[0]);
      const marked = m[1] !== undefined || m[2] !== undefined;
      if (held.has(n) || (!marked && /^\d+$/.test(n) && Number(n) <= 12)) continue;
      const at = m.index ?? 0;
      out.push(`"…${t.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, ' ').trim()}…"`);
    }
  }
  return [...new Set(out)];
}
