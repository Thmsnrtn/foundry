// =============================================================================
// FOUNDRY - what people say to each other, which a registry can never tell you
//
// The second real source, chosen because it KNOWS DIFFERENTLY rather than
// because another API was convenient. A registry answers "what exists". A
// public discussion archive answers "what do people complain about, work
// around, or give up on".
//
// AND THOSE TWO CAN DISAGREE, WHICH IS THE POINT. A problem can be well served
// by a maintained package and still have people describing, in their own words,
// the part that hurts - and no amount of registry evidence would ever surface
// it. Contradiction between source families is not a mess to be averaged away;
// it is the shape of a thesis that needs revising.
//
// WHAT IT CANNOT TELL US. Who is speaking, whether they are the customer,
// whether the complaint is current, and above all whether anybody would pay.
// A community is loud about pain and silent about money.
// =============================================================================

import { safeFetch } from '../../outbound/ssrf.js';

const SEARCH = 'https://hn.algolia.com/api/v1/search';

export const CAN_SEE = 'public technical discussion: what people said to each other '
  + 'about a problem, when they said it, and how much attention it got';

export const CANNOT_SEE = 'who is speaking and whether they are the customer, whether '
  + 'a complaint is still true, how many people quietly had the same problem and said '
  + 'nothing, and whether anybody would pay to have it solved';

export const WOULD_MOST_HELP = 'somebody with the problem, asked directly - a community '
  + 'is loud about pain and silent about money';

export interface Said {
  id: string;
  /** What was written, stripped of markup, trimmed to something readable. */
  text: string;
  url: string;
  saidAt: string | null;
  /** How much attention it got, where that is knowable. */
  points: number | null;
  /** Whether it is a story or a comment - a comment is somebody replying. */
  kind: 'story' | 'comment';
}

export interface Discussion {
  terms: string; total: number; url: string; observedAt: Date; found: Said[];
}

/** HTML entities and tags, because people write links and quotes. */
function readable(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * WHAT PEOPLE SAID ABOUT THIS.
 *
 * Comments rather than story titles by default: a title is somebody promoting
 * a thing, a comment is somebody reacting to it, and reactions are where the
 * complaint lives.
 */
export async function whatPeopleSaid(terms: string, size = 15): Promise<Discussion> {
  const url = `${SEARCH}?query=${encodeURIComponent(terms)}&tags=comment`
    + `&hitsPerPage=${String(Math.min(Math.max(size, 1), 30))}`;
  const res = await safeFetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`the discussion archive answered ${String(res.status)}`);
  const body = await res.json() as {
    nbHits?: number;
    hits?: Array<{ objectID?: string; comment_text?: string; story_text?: string;
      title?: string; created_at?: string; points?: number; story_id?: number }>;
  };
  return {
    terms, total: Number(body.nbHits ?? 0), url, observedAt: new Date(),
    found: (body.hits ?? []).map((h) => {
      const text = readable(h.comment_text ?? h.story_text ?? h.title ?? '');
      return {
        id: String(h.objectID ?? ''),
        // Kept long enough that a relevance judgement made on it is made on
        // what the person actually wrote. Judging aboutness from a two-line
        // excerpt drops genuine hits whose subject appears further down.
        text: text.slice(0, 1500),
        url: `https://news.ycombinator.com/item?id=${String(h.objectID ?? '')}`,
        saidAt: h.created_at ?? null,
        points: typeof h.points === 'number' ? h.points : null,
        kind: (h.comment_text ? 'comment' : 'story') as 'story' | 'comment',
      };
    }).filter((s) => s.text.length > 0),
  };
}
