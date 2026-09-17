// =============================================================================
// FOUNDRY - what people report broken or missing
//
// An issue on a public tracker is somebody who already uses a thing writing
// down what it does not do. It is the same kind of knowing as a forum comment
// - somebody said something, in public, at a date - and it is filed as
// community for exactly that reason. It is louder about the software people
// already have than about problems nobody has built for, and that is its
// limit.
//
// GitHub's search, read without a credential: a handful of requests a minute,
// which is plenty for one pass a day. A rate refusal is thrown, not hidden.
// =============================================================================
import { readJson, readable } from './fetching.js';
import type { Discussion, Said } from './community.js';

const SEARCH = 'https://api.github.com/search/issues';

export const CAN_SEE = 'what people who already use some software report as broken or '
  + 'missing, when, and how many others reacted';
export const CANNOT_SEE = 'anybody who does not use that software, whether the reporter '
  + 'would pay for a fix, and whether the problem exists outside developers';
export const WOULD_MOST_HELP = 'the same complaint from somebody who is not a developer';

/** WHAT IS REPORTED BROKEN, in the shape a discussion has, so the same reader sows from it. */
export async function whatIsReportedBroken(terms: string, size = 10): Promise<Discussion> {
  const q = `${terms} is:issue`;
  const url = `${SEARCH}?q=${encodeURIComponent(q)}&sort=reactions&order=desc&per_page=${String(size)}`;
  const observedAt = new Date();
  const body = await readJson<{ total_count?: number; items?: Array<{
    number?: number; title?: string; body?: string | null; html_url?: string; created_at?: string;
    comments?: number; reactions?: { total_count?: number };
  }> }>(url, { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });
  const found: Said[] = (body.items ?? []).map((i) => {
    const text = readable(`${i.title ?? ''}. ${i.body ?? ''}`).slice(0, 1500);
    return {
      id: String(i.number ?? ''), text, url: i.html_url ?? url, saidAt: i.created_at ?? null,
      points: typeof i.reactions?.total_count === 'number' ? i.reactions.total_count : (i.comments ?? null),
      kind: 'comment' as const,
    };
  }).filter((s) => s.text.length > 0);
  return { terms, total: body.total_count ?? found.length, url, observedAt, found };
}
