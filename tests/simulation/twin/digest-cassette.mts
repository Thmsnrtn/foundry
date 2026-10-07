// =============================================================================
// THE CASSETTE, DIGESTED — counts only, never content.
//
// `from-nothing-to-a-sale` recorded what the real public sources answered the
// eyes (FROM_NOTHING_CASSETTE, 6 October 2026: Hacker News, GitHub issues,
// npm, the App Store, search suggestions, Wikipedia, remote job postings).
// The twin may lean on those observations, so this reduces them to the
// numbers it uses — how many items a query returned, how many matched the
// archive in total, how many of the returned items said something that reads
// like a complaint — and writes them to `sources/cassette-digest.json`, which
// is committed. Nobody's words are copied: the digest carries counts, hosts
// and the query words the institution itself chose.
//
//   FROM_NOTHING_CASSETTE=/path/to/cassette.json npx tsx tests/simulation/twin/digest-cassette.mts
// =============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = process.env.FROM_NOTHING_CASSETTE;
if (!path) { process.stderr.write('set FROM_NOTHING_CASSETTE to the recorded cassette\n'); process.exit(2); }
const cassette = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { status: number; body: string; at: string }>;

/** Words that, in the eyes' own query vocabulary, mark somebody describing a chore or a gap. */
const PAIN = /\b(manually|by hand|spreadsheet|keep track|every week|every month|no tool|wish there (?:was|were)|tedious|i wrote a script|have to check)\b/i;
const strip = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/&[#a-z0-9]+;/gi, ' ').replace(/\s+/g, ' ');

interface PerQuery { host: string; query: string; returned: number; total: number | null; painSaid: number; recordedAt: string }
const perQuery: PerQuery[] = [];
for (const [key, hit] of Object.entries(cassette)) {
  const url = new URL(key.split(' ')[1]!);
  const host = url.host;
  const query = url.searchParams.get('query') ?? url.searchParams.get('q') ?? url.searchParams.get('term') ?? url.searchParams.get('text') ?? url.searchParams.get('search') ?? url.pathname;
  let returned = 0; let total: number | null = null; let painSaid = 0;
  try {
    const body = JSON.parse(hit.body) as Record<string, unknown>;
    const items = (body.hits ?? body.items ?? body.objects ?? body.results ?? body.jobs ?? (Array.isArray(body) ? body : null)) as unknown[] | null;
    if (Array.isArray(items)) {
      returned = items.length;
      painSaid = items.filter((i) => PAIN.test(strip(JSON.stringify(i)))).length;
    }
    const t = body.nbHits ?? body.total_count ?? body.total ?? body.resultCount ?? body['job-count'];
    total = typeof t === 'number' ? t : null;
  } catch { /* not JSON: counted as nothing returned */ }
  perQuery.push({ host, query: query.slice(0, 80), returned, total, painSaid, recordedAt: hit.at.slice(0, 10) });
}
const byHost: Record<string, { queries: number; returned: number[]; total: Array<number | null>; painSaid: number[] }> = {};
for (const q of perQuery) {
  const h = (byHost[q.host] ??= { queries: 0, returned: [], total: [], painSaid: [] });
  h.queries += 1; h.returned.push(q.returned); h.total.push(q.total); h.painSaid.push(q.painSaid);
}
const out = {
  what: 'Counts digested from the from-nothing cassette (real public-source answers recorded 2026-10-06). No content is copied.',
  recordedOn: [...new Set(perQuery.map((q) => q.recordedAt))].sort(),
  keys: perQuery.length,
  byHost,
};
writeFileSync(resolve(import.meta.dirname, 'sources/cassette-digest.json'), `${JSON.stringify(out, null, 1)}\n`);
process.stdout.write(`digested ${String(perQuery.length)} recorded answers from ${String(Object.keys(byHost).length)} hosts\n`);
