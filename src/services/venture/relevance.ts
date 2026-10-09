// =============================================================================
// FOUNDRY - is this row about this candidate (F3)
//
// The eyes now read wider and fresher — newest-first forums in rotating words,
// a marketplace, a second forum — and wider reading brings more rows that are
// about something else. A reviewer (the forge's five lenses, the attacker)
// given a row about a different problem reasons from it as if it were about
// this one. So before any row reaches a reviewer it must SHARE THE SUBJECT:
// two of the candidate's own content words, as whole words, in what the row
// says. Words every row about printable files shares ("printable", "template",
// "track") do not count. A row that fails is dropped from what the reviewer is
// given and COUNTED, so the record says how much was left out.
//
// This is a floor, not comprehension: it cannot tell a complaint from praise,
// and it can admit a row that shares two words by accident. It is checked
// against scripted judges in the twin (the-eyes-stay-on-topic gate).
// =============================================================================

/** Words that say nothing about which problem a row is about. */
const GENERIC = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'our', 'their', 'they', 'them', 'have', 'has', 'had',
  'are', 'was', 'were', 'not', 'but', 'all', 'any', 'can', 'could', 'would', 'should', 'will', 'just', 'like', 'than',
  'then', 'when', 'what', 'which', 'who', 'how', 'why', 'where', 'there', 'here', 'into', 'out', 'about', 'over',
  'people', 'person', 'someone', 'somebody', 'anybody', 'nobody', 'everyone', 'thing', 'things', 'something', 'anything',
  'every', 'each', 'one', 'two', 'more', 'most', 'some', 'many', 'much', 'very', 'really', 'still', 'also', 'only',
  'printable', 'printables', 'template', 'templates', 'file', 'files', 'pdf', 'page', 'pages', 'track', 'keep', 'keeping',
  'simple', 'easy', 'free', 'use', 'using', 'used', 'need', 'needs', 'want', 'wants', 'make', 'made', 'get', 'got',
  'time', 'times', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years', 'list', 'lists', 'paper', 'hand',
  'way', 'ways', 'work', 'does', 'did', 'done', 'doing', 'know', 'think', 'say', 'said', 'wrote', 'write',
]);

/** The content words of a text, lower-cased and singular, generic words left out. */
export function contentWords(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/)
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !GENERIC.has(w)));
}

/** Two shared content words: about the same subject. */
export const SHARED_FOR_A_SUBJECT = 2;

/** Is `text` about the subject `subject` names? The shared words are returned, so the judgement can be checked. */
export function isAbout(subject: string, text: string): { about: boolean; shared: string[] } {
  const want = contentWords(subject);
  const have = contentWords(text);
  const shared = [...want].filter((w) => have.has(w));
  return { about: shared.length >= Math.min(SHARED_FOR_A_SUBJECT, want.size), shared };
}

/** Keep the rows about the subject; count the rest. */
export function keepWhatIsAbout<T>(subject: string, rows: readonly T[], textOf: (r: T) => string): { kept: T[]; dropped: number } {
  const kept = rows.filter((r) => isAbout(subject, textOf(r)).about);
  return { kept, dropped: rows.length - kept.length };
}
