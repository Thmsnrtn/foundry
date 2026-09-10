// =============================================================================
// FOUNDRY — An experiment's public identity: a number, a slug, and the words.
//
// Given once. The address a stranger was sent to must answer years later,
// whatever became of the test, so the number and the slug never change (the
// row refuses). The public copy is authored for publication, separately from
// the private design, and is the only text the page renders from besides the
// canonical facts (status, price, dates) the projection reads.
// =============================================================================
import { query } from '../../db/client.js';

export interface PublicCopy { title: string; summary: string; who: string; what: string; limits: string; sources: string; selection: string; note: string }

/** The copy that can be improved after the identity exists, specimen included. */
export type EditableCopy = Partial<PublicCopy> & { sample?: string | null };

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

export async function nextExperimentNumber(founderId: string): Promise<number> {
  const r = (await rows('SELECT coalesce(max(number), 0) AS n FROM public_experiments WHERE founder_id = ?', [founderId]))[0];
  return Number(r?.n ?? 0) + 1;
}

export async function publicIdentityOf(experimentId: string): Promise<{ number: number; slug: string; listed: boolean; copy: PublicCopy; outcome: string | null; supersedes: string | null } | null> {
  const r = (await rows('SELECT * FROM public_experiments WHERE experiment_id = ?', [experimentId]))[0];
  if (!r) return null;
  return {
    number: Number(r.number), slug: String(r.slug), listed: Number(r.listed) === 1,
    copy: { title: String(r.public_title), summary: String(r.public_summary), who: String(r.public_who), what: String(r.public_what), limits: String(r.public_limits), sources: String(r.public_sources), selection: String(r.public_selection), note: String(r.public_note) },
    outcome: r.public_outcome == null ? null : String(r.public_outcome), supersedes: r.supersedes_experiment_id == null ? null : String(r.supersedes_experiment_id),
  };
}

/** Idempotent on the experiment: a second call returns the identity it has. */
export async function givePublicIdentity(input: { experimentId: string; founderId: string; slug: string; copy: PublicCopy & { sample?: string | null }; listed?: boolean; number?: number; supersedesExperimentId?: string | null }): Promise<{ number: number; slug: string; created: boolean }> {
  const existing = await publicIdentityOf(input.experimentId);
  if (existing) return { number: existing.number, slug: existing.slug, created: false };
  const number = input.number ?? await nextExperimentNumber(input.founderId);
  const slug = slugify(input.slug);
  const c = input.copy;
  await query(
    `INSERT INTO public_experiments (experiment_id, founder_id, number, slug, listed, public_title, public_summary, public_who, public_what, public_limits, public_sources, public_selection, public_note, public_sample, supersedes_experiment_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [input.experimentId, input.founderId, number, slug, input.listed === false ? 0 : 1, c.title, c.summary, c.who, c.what, c.limits, c.sources, c.selection, c.note, input.copy.sample?.trim() || null, input.supersedesExperimentId ?? null]);
  return { number, slug, created: true };
}

/** The words can improve; the identity cannot. */
export async function updatePublicCopy(experimentId: string, copy: EditableCopy): Promise<void> {
  const sets: string[] = []; const params: unknown[] = [];
  const map: Record<keyof EditableCopy, string> = { title: 'public_title', summary: 'public_summary', who: 'public_who', what: 'public_what', limits: 'public_limits', sources: 'public_sources', selection: 'public_selection', note: 'public_note', sample: 'public_sample' };
  for (const [k, col] of Object.entries(map) as Array<[keyof EditableCopy, string]>) if (copy[k] !== undefined) { sets.push(`${col} = ?`); params.push(copy[k] ?? null); }
  if (!sets.length) return;
  await query(`UPDATE public_experiments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE experiment_id = ?`, [...params, experimentId]);
}

/** Written once the test has ended, in public words at the right abstraction. */
export async function recordPublicOutcome(experimentId: string, outcome: string): Promise<void> {
  await query(`UPDATE public_experiments SET public_outcome = ?, updated_at = datetime('now') WHERE experiment_id = ?`, [outcome.trim(), experimentId]);
}

/** Graduation is a promotion the owner records; the page stays and points on. */
export async function markGraduated(experimentId: string, url: string): Promise<void> {
  if (!/^https:\/\/[^\s/]+/.test(url)) throw new Error('a graduated venture lives at an https address');
  await query(`UPDATE public_experiments SET graduated_to_url = ?, updated_at = datetime('now') WHERE experiment_id = ?`, [url, experimentId]);
}
