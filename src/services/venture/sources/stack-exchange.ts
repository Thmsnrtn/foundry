// =============================================================================
// FOUNDRY - what people ask each other, newest first (F3)
//
// A second forum, chosen because its people are not Hacker News's: Stack
// Exchange runs question sites about money, parenting, households and pets,
// where people describe the everyday work printable files are for. Read through
// its documented API 2.3 (`/search/advanced`, sorted by creation date, newest
// first), never its pages; the content is CC BY-SA and each item keeps its link.
//
// THE SITES ROTATE, a day at a time, so a week of passes reads five different
// rooms rather than one room five times.
//
// WHAT IT CANNOT TELL US: who is asking beyond what they wrote, whether the
// answer they got solved it, and whether anybody would pay.
// =============================================================================
import { readJson, readable } from './fetching.js';

const SEARCH = 'https://api.stackexchange.com/2.3/search/advanced';

/** The rooms, in the order they are visited, one a day. */
export const SITES = ['money', 'parenting', 'lifehacks', 'diy', 'pets'] as const;

/** The room for a given day: deterministic, so a pass can be replayed. */
export function siteFor(day: Date): typeof SITES[number] {
  return SITES[Math.floor(day.getTime() / 86_400_000) % SITES.length]!;
}

export interface Asked { id: string; text: string; url: string; saidAt: string | null; points: number | null; kind: 'story' | 'comment' }

/** WHAT PEOPLE ASKED about these words, newest first, on one site. */
export async function whatPeopleAsked(terms: string, site: string, size = 10): Promise<{ terms: string; total: number; url: string; observedAt: Date; found: Asked[] }> {
  const q = new URLSearchParams({ order: 'desc', sort: 'creation', q: terms, site, pagesize: String(Math.min(Math.max(size, 1), 30)), filter: 'withbody' });
  const url = `${SEARCH}?${q.toString()}`;
  const body = await readJson<{ items?: Array<{ question_id?: number; title?: string; body?: string; link?: string; creation_date?: number; score?: number }>; total?: number }>(url);
  const found = (body.items ?? []).map((i) => ({
    id: String(i.question_id ?? ''),
    text: readable(`${i.title ?? ''}. ${i.body ?? ''}`).slice(0, 1500),
    url: typeof i.link === 'string' && i.link.startsWith('https://') ? i.link : `https://${site}.stackexchange.com/q/${String(i.question_id ?? '')}`,
    saidAt: Number.isFinite(Number(i.creation_date)) ? new Date(Number(i.creation_date) * 1000).toISOString() : null,
    points: typeof i.score === 'number' ? i.score : null,
    kind: 'story' as const,
  })).filter((a) => a.id !== '' && a.text.length > 1);
  return { terms, total: Number(body.total ?? found.length), url, observedAt: new Date(), found };
}
