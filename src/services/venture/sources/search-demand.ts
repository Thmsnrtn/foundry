// =============================================================================
// FOUNDRY - what people are typing into a search box
//
// A search engine's autocomplete is the one public trace of what people look
// for by name, before anybody has sold them anything. It is a demand signal
// and only that: it says people are looking, not that they would pay, and it
// says nothing about how many. The completions that share the words we asked
// with are the finding; the words they add ("template", "free", "excel",
// "app") are the shape they expect the answer to take, which is worth as much.
//
// No credential, no account, no cost.
// =============================================================================
import { readJson } from './fetching.js';
import { relevanceOf } from './npm-registry.js';

const AUTOCOMPLETE = 'https://duckduckgo.com/ac/';

export const CAN_SEE = 'what people type into a search box about a problem, and the words '
  + 'they add to it, which say what shape of answer they expect';
export const CANNOT_SEE = 'how many people search for it, who they are, whether they found '
  + 'anything, and whether they would pay for what they were looking for';
export const WOULD_MOST_HELP = 'a search volume from a system of record, or somebody with the '
  + 'problem saying what they did after searching';

export const CANNOT_TELL_US: Array<{ question: string; wouldNeed: string }> = [
  { question: 'how many people are actually looking for this',
    wouldNeed: 'a search volume from a system of record' },
  { question: 'whether the people looking would pay rather than keep looking',
    wouldNeed: 'a real offer shown to some of them' },
];

export interface Completion { text: string; relevant: boolean; shared: string[]; adds: string[] }
export interface Demand {
  terms: string; url: string; observedAt: Date; found: Completion[];
  /** The words people add to what we asked, counted, most common first. */
  wanted: Array<{ word: string; n: number }>;
}

/** WHAT PEOPLE SEARCH FOR, given a phrase. */
export async function whatPeopleSearchFor(terms: string): Promise<Demand> {
  const url = `${AUTOCOMPLETE}?q=${encodeURIComponent(terms)}&type=list`;
  const observedAt = new Date();
  const body = await readJson<unknown>(url);
  const list = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as unknown[]).map(String) : [];
  const asked = new Set(terms.toLowerCase().split(/\s+/).filter(Boolean));
  const found = list.map((text) => {
    const rel = relevanceOf(terms, text, null);
    const adds = text.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !asked.has(w));
    return { text, relevant: rel.relevant, shared: rel.shared, adds };
  });
  const counts = new Map<string, number>();
  for (const c of found.filter((f) => f.relevant)) for (const w of c.adds) counts.set(w, (counts.get(w) ?? 0) + 1);
  const wanted = [...counts.entries()].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  return { terms, url, observedAt, found, wanted };
}
