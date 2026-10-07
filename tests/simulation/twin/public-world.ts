// =============================================================================
// THE PUBLIC WORLD THE EYES READ — the twin's people, talking in public.
//
// The institution's eyes read real public sources through `fetch`. In a twin
// run they read THIS instead: answers in each source's own wire shape, made
// from the twin's segments and themes, so that what the institution finds is
// what the twin's people actually need — and so that it has to FIND it, from
// mostly irrelevant chatter, the way it would in the world.
//
// NOTHING HERE IS EVIDENCE OF ANYTHING. Every post, suggestion, app and page
// view below is generated from a seed and labelled as generated in its own
// text where a reader could see it; the counts that shape it (how many items
// a search returns, how many of them voice a chore) come from the cassette
// digest and are named in params.ts.
// =============================================================================
import { Rng, hashOf } from './rng.js';
import { THEMES, themeOf, themeDemand, type ThemeKey } from './segments.js';
import type { Drawn } from './params.js';

const NOISE = [
  'The build broke again after the dependency bump; pinning the version fixed it.',
  'We moved the service to a managed database and the latency went down.',
  'Honestly the documentation for this library is better than most.',
  'I tried three editors this year and went back to the first one.',
  'Their pricing page changed twice this month and nobody announced it.',
  'The keynote was mostly a product launch with a few good demos.',
  'Remote work made our standups shorter and our documents longer.',
  'I still think the old interface was faster for power users.',
];

export interface PublicWorld {
  /** Answer one public-source request, or null when the URL is not a public source the twin plays. */
  answer(url: string): Response | null;
  /** How many requests each host received, for the scorecard. */
  calls: Record<string, number>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PUBLIC = /^https:\/\/(hn\.algolia\.com|registry\.npmjs\.org|api\.npmjs\.org|api\.github\.com|wikimedia\.org|[a-z]+\.wikipedia\.org|duckduckgo\.com|itunes\.apple\.com|remotive\.com)\//;

/**
 * THE TWIN'S PUBLIC WORLD for one seed. `day()` is read on every answer, so
 * posts change week by week the way an archive grows.
 */
export function publicWorld(seed: number, p: Drawn, day: () => number): PublicWorld {
  const calls: Record<string, number> = {};
  // Whole days before today, so the same seed answers the same words with the same text all day.
  const isoDaysAgo = (n: number): string => new Date((Math.floor(Date.now() / 86_400_000) - n) * 86_400_000).toISOString();

  /** A post in which a member of a theme's segments describes a chore, quoting the searched words where they fit. */
  function voiceOf(theme: ThemeKey, r: Rng, query: string): string {
    const t = THEMES[theme];
    const thing = r.pick(t.things); const chore = r.pick(t.chores); const wish = r.pick(t.wishes);
    const q = query.trim().toLowerCase();
    const opener = q.startsWith('doing this manually every') ? `I end up doing this manually every month: ${thing}.`
      : q.startsWith('keep a spreadsheet for') ? `I keep a spreadsheet for ${thing}.`
      : q.startsWith('wrote a script to keep track') ? `I once wrote a script to keep track of ${thing}.`
      : q.startsWith('have to check every week') ? `I have to check every week on ${thing}.`
      : `I keep track of ${thing} by hand.`;
    return `${opener.replace(/\s+/g, ' ')} ${chore[0]!.toUpperCase()}${chore.slice(1)}. Honestly ${wish} would be enough.`;
  }

  /** The themes a query could reach: the one its words name, or, for a chore phrase, any. */
  function themesFor(query: string): ThemeKey[] {
    const named = themeOf(query);
    if (named) return [named];
    return /spreadsheet|keep track|manually|every week|no tool|by hand|wish|printable|template|checklist|log\b|planner|tracker/i.test(query)
      ? (Object.keys(THEMES) as ThemeKey[]) : [];
  }

  function discussion(query: string, size: number, host: string): Array<{ id: string; text: string; at: string; points: number }> {
    const week = Math.floor(day() / 7);
    const r = new Rng('hits', seed, host, query.toLowerCase(), week);
    const n = Math.min(size, Math.max(0, Math.round(p['eyes.hitsPerQuery'] * (0.6 + 0.8 * r.next()))));
    const themes = themesFor(query);
    const out: Array<{ id: string; text: string; at: string; points: number }> = [];
    for (let i = 0; i < n; i++) {
      const id = String(hashOf(seed, host, query, week, i) % 90_000_000 + 10_000_000);
      // A post is a voice only when it is about a theme somebody has, weighted by how many people have it.
      const theme = themes.length ? themes[Math.floor(r.next() * themes.length)]! : null;
      const voiced = theme !== null && r.chance(Math.min(0.95, p['eyes.painShare'] * themeDemand(theme) * (themes.length === 1 ? 2 : 1)));
      out.push({ id, text: voiced && theme ? voiceOf(theme, r, query) : r.pick(NOISE), at: isoDaysAgo(r.int(0, 30)), points: r.int(0, 40) });
    }
    return out;
  }

  function answer(url: string): Response | null {
    if (!PUBLIC.test(url)) return null;
    const u = new URL(url);
    calls[u.host] = (calls[u.host] ?? 0) + 1;
    const q = u.searchParams;
    switch (u.host) {
      case 'hn.algolia.com': {
        const query = q.get('query') ?? '';
        const hits = discussion(query, Number(q.get('hitsPerPage') ?? 15), u.host);
        return json({ nbHits: hits.length * 37, hits: hits.map((h) => ({ objectID: h.id, comment_text: h.text, created_at: h.at, points: h.points })) });
      }
      case 'api.github.com': {
        if (!u.pathname.startsWith('/search/issues')) return json({ message: 'Not Found' }, 404);
        const query = (q.get('q') ?? '').replace(/\bis:issue\b/g, '').trim();
        // Issue trackers are about software: the twin's people do not file issues about printables.
        const r = new Rng('issues', seed, query, Math.floor(day() / 7));
        const items = Array.from({ length: Math.min(5, r.int(0, 5)) }, (_, i) => ({
          number: hashOf(seed, query, i) % 9000 + 1000, title: r.pick(NOISE), body: r.pick(NOISE),
          html_url: `https://github.com/twin/example/issues/${String(i + 1)}`, created_at: isoDaysAgo(r.int(1, 200)), comments: r.int(0, 9) }));
        return json({ total_count: items.length * 1000, items });
      }
      case 'duckduckgo.com': {
        const term = (q.get('q') ?? '').trim();
        const theme = themeOf(term);
        const r = new Rng('ac', seed, term);
        const adds = theme ? ['printable', 'template', 'free printable', 'pdf', 'checklist', 'binder', 'app'] : ['meaning', 'online', 'near me'];
        const list = r.chance(theme ? 0.95 : 0.4) ? adds.slice(0, r.int(2, adds.length)).map((a) => `${term} ${a}`) : [];
        return json([term, list]);
      }
      case 'en.wikipedia.org': {
        const term = q.get('search') ?? '';
        const theme = themeOf(term);
        return json([term, theme ? [THEMES[theme].name.replace(/^\w/, (c) => c.toUpperCase())] : [], [], []]);
      }
      case 'wikimedia.org': {
        const article = decodeURIComponent(u.pathname.split('/')[7] ?? '').replace(/_/g, ' ');
        const theme = themeOf(article);
        const r = new Rng('views', seed, article);
        const base = theme ? 400 * themeDemand(theme) : 50;
        return json({ items: [0, 1, 2].map((m) => ({ timestamp: `2026${String(7 + m).padStart(2, '0')}0100`, views: Math.round(base * (0.7 + 0.6 * r.next())) })) });
      }
      case 'itunes.apple.com': {
        if (u.pathname.startsWith('/us/rss/customerreviews')) {
          const r = new Rng('reviews', seed, u.pathname);
          return json({ feed: { entry: Array.from({ length: r.int(0, 6) }, (_, i) => ({
            id: { label: String(i) }, title: { label: r.chance(0.5) ? 'Too complicated' : 'Does the job' },
            content: { label: r.chance(0.5) ? 'I wanted something simple I could print, not another app with a subscription.' : 'Works, though I would rather have it on paper.' },
            'im:rating': { label: String(r.int(1, 5)) }, updated: { label: isoDaysAgo(r.int(1, 90)) } })) } });
        }
        const term = q.get('term') ?? '';
        const theme = themeOf(term);
        const r = new Rng('apps', seed, term);
        const n = theme ? r.int(1, 6) : r.int(0, 3);
        return json({ resultCount: n, results: Array.from({ length: n }, (_, i) => ({
          trackId: hashOf(seed, term, i) % 900_000_000 + 100_000_000,
          trackName: theme ? `${THEMES[theme].name.replace(/\b\w/g, (c) => c.toUpperCase())} ${['Pro', 'Plus', 'Simple', 'Keeper', 'Organizer', 'Tracker'][i % 6]!}` : `Utility ${String(i + 1)}`,
          sellerName: `Twin Apps ${String(i + 1)}`, description: theme ? `Keep track of ${THEMES[theme].things[0]!}. A twin-generated app listing.` : 'A twin-generated app listing.',
          price: r.chance(0.6) ? 0 : 2.99, averageUserRating: Math.round((3 + 2 * r.next()) * 10) / 10, userRatingCount: r.int(0, 4000),
          currentVersionReleaseDate: isoDaysAgo(r.int(10, 900)) })) });
      }
      case 'registry.npmjs.org': {
        if (u.pathname.startsWith('/-/v1/search')) {
          // A registry holds software, not printables: for a theme's words it
          // returns a few small packages on the subject, mostly left
          // unmaintained years ago — something that saw the subject, which a
          // search that found nothing is not. The share left maintained is an
          // assumption (a quarter), as is the count (none to three).
          const text = q.get('text') ?? '';
          const theme = themeOf(text);
          const r = new Rng('registry', seed, text);
          if (!theme) return json({ total: 0, objects: [] });
          const n = r.int(0, 3);
          const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
          return json({ total: n * 4, objects: Array.from({ length: n }, (_, i) => ({ package: {
            name: `${words.join('-') || THEMES[theme].key}-${['cli', 'kit', 'js'][i % 3]!}`, version: `0.${String(r.int(1, 9))}.0`,
            date: isoDaysAgo(r.chance(0.25) ? r.int(10, 300) : r.int(800, 2200)),
            description: `Keep track of ${THEMES[theme].name} entries from the command line (${words.join(' ')})`,
            links: { npm: `https://www.npmjs.com/package/${words.join('-')}-${String(i)}` } } })) });
        }
        // A package's own record: present, maintained, quiet.
        const name = decodeURIComponent(u.pathname.slice(1));
        return json({ name, description: `${name} (twin record)`, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} },
          time: { created: isoDaysAgo(900), modified: isoDaysAgo(20), '1.0.0': isoDaysAgo(20) }, maintainers: [{ name: 'twin' }] });
      }
      case 'api.npmjs.org':
        return json({ downloads: 1000, start: isoDaysAgo(7).slice(0, 10), end: isoDaysAgo(0).slice(0, 10) });
      case 'remotive.com':
        return json({ 'job-count': 0, jobs: [] });
      default:
        return json({}, 404);
    }
  }
  return { answer, calls };
}
