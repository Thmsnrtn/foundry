// =============================================================================
// FOUNDRY - what organisations are paying people to do
//
// A job advert is an organisation putting money against a problem, which is
// the strongest public evidence that the work is real and costs something. It
// is not evidence that they would pay a stranger's product instead of a
// person, and this file says so every time it is used.
//
// Remotive's public feed of remote jobs, read-only, no credential. Remote-only
// is a real limit and is stated as one: a plumber's office does not advertise
// here.
// =============================================================================
import { readJson, readable } from './fetching.js';
import { relevanceOf } from './npm-registry.js';

const JOBS = 'https://remotive.com/api/remote-jobs';

export const CAN_SEE = 'which organisations are advertising to pay somebody to do this work, '
  + 'what they call the job, what they will pay, and when they posted it';
export const CANNOT_SEE = 'the far larger number of organisations that never advertise, '
  + 'whether any of them would buy a product rather than hire, and anything outside '
  + 'remote work';
export const WOULD_MOST_HELP = 'a wider board, or one of these organisations asked whether '
  + 'they would pay for a tool that did part of the job';

export const CANNOT_TELL_US: Array<{ question: string; wouldNeed: string }> = [
  { question: 'whether an organisation paying a person would pay for a product instead',
    wouldNeed: 'asking one of them, or a real offer' },
  { question: 'whether the work is done outside the remote roles this board lists',
    wouldNeed: 'a wider board, or a source that sees local work' },
];

export interface Posting {
  id: string; title: string; company: string; url: string; category: string | null;
  postedAt: string | null; salary: string | null; excerpt: string;
  relevant: boolean; shared: string[];
}
export interface Hiring { terms: string; total: number; url: string; observedAt: Date; found: Posting[] }

interface RemotiveJob {
  id?: number; url?: string; title?: string; company_name?: string; category?: string;
  publication_date?: string; salary?: string; description?: string;
}

/** WHO IS HIRING FOR THIS, in public. */
export async function whoIsHiringFor(terms: string, limit = 20): Promise<Hiring> {
  const url = `${JOBS}?search=${encodeURIComponent(terms)}&limit=${String(limit)}`;
  const observedAt = new Date();
  const body = await readJson<{ 'total-job-count'?: number; 'job-count'?: number; jobs?: RemotiveJob[] }>(url);
  const found = (body.jobs ?? []).filter((j) => j.id !== undefined).map((j) => {
    const excerpt = readable(j.description ?? '').slice(0, 400);
    const rel = relevanceOf(terms, j.title ?? '', excerpt);
    return {
      id: String(j.id), title: j.title ?? 'untitled', company: j.company_name ?? 'unknown',
      url: j.url ?? `https://remotive.com/remote-jobs/${String(j.id)}`, category: j.category ?? null,
      postedAt: j.publication_date ?? null, salary: j.salary?.trim() || null, excerpt,
      relevant: rel.relevant, shared: rel.shared,
    };
  });
  return { terms, total: body['job-count'] ?? found.length, url, observedAt, found };
}
