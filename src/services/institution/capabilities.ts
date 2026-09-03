// =============================================================================
// FOUNDRY - the capability fabric
//
// "Can Foundry actually do this, with what, at what cost, and how far has
// that been proven?" - answered from a registry of concepts and their
// implementations, so the institution can move from "I know what should
// happen" to "I can carry this", "I cannot yet, and here is what it would
// take", or "this is yours".
//
// NOTHING ARRIVES PROVEN. A provider is declared, then available, then
// controlled-proven by a rehearsal, then reality-proven by the world - and the
// last two steps are witnessed changes with a name and the evidence, never a
// column somebody set. Reliable is a claim about a history and only reality
// has one.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type Maturity = 'declared' | 'available' | 'controlled_proven' | 'reality_proven'
  | 'reliable' | 'degraded' | 'unavailable';

const ORDER: Record<Maturity, number> = {
  unavailable: 0, declared: 1, degraded: 2, available: 3, controlled_proven: 4,
  reality_proven: 5, reliable: 6,
};

export const MATURITY_IN_PLAIN_WORDS: Record<Maturity, string> = {
  declared: 'named, and nothing more',
  available: 'wired up, exercised in tests',
  controlled_proven: 'proven in the rehearsal world',
  reality_proven: 'has worked in the world at least once, witnessed',
  reliable: 'has worked in the world repeatedly',
  degraded: 'working, but not well',
  unavailable: 'not working',
};

export interface Provider {
  id: string; provider: string; how: string; tool: string | null;
  costNote: string; maturity: Maturity; since: string;
  /** How it got to where it is: the last witnessed change, or null if never moved. */
  provenBy: { from: Maturity; to: Maturity; by: string; evidence: string } | null;
}

export interface Capability {
  key: string; family: string; whatItDoes: string; rung: string;
  providers: Provider[];
  /** The most proven provider, or null when nothing can supply it. */
  best: Provider | null;
}

export async function capability(key: string): Promise<Capability | null> {
  const c = (await query(
    'SELECT capability_key, family, what_it_does, rung FROM capabilities WHERE capability_key = ?',
    [key])).rows[0] as Record<string, unknown> | undefined;
  if (!c) return null;
  const providers: Provider[] = [];
  for (const p of (await query(
    `SELECT id, provider, how, tool, cost_note, maturity, maturity_since
       FROM capability_providers WHERE capability_key = ? ORDER BY sort_order, rowid`, [key]))
    .rows as unknown as Array<Record<string, unknown>>) {
    // THE LAST WITNESSED CHANGE travels with the maturity, so "reality-proven"
    // is never shown without who saw what. A maturity with no history is one
    // that has never moved, which is its own fact.
    const last = (await query(
      `SELECT from_maturity, to_maturity, witnessed_by, evidence
         FROM capability_maturity_changes WHERE provider_id = ?
        ORDER BY changed_at DESC, rowid DESC LIMIT 1`, [String(p.id)]))
      .rows[0] as Record<string, unknown> | undefined;
    providers.push({
      id: String(p.id), provider: String(p.provider), how: String(p.how),
      tool: p.tool == null ? null : String(p.tool), costNote: String(p.cost_note),
      maturity: String(p.maturity) as Maturity, since: String(p.maturity_since).slice(0, 10),
      provenBy: last === undefined ? null : {
        from: String(last.from_maturity) as Maturity, to: String(last.to_maturity) as Maturity,
        by: String(last.witnessed_by), evidence: String(last.evidence),
      },
    });
  }
  const usable = providers.filter((p) => p.maturity !== 'unavailable');
  const best = usable.sort((a, b) => ORDER[b.maturity] - ORDER[a.maturity])[0] ?? null;
  return {
    key, family: String(c.family), whatItDoes: String(c.what_it_does),
    rung: String(c.rung), providers, best,
  };
}

/** Every capability, grouped by family. Institutional machinery, not a page. */
export async function everyCapability(): Promise<Capability[]> {
  const keys = ((await query(
    'SELECT capability_key FROM capabilities ORDER BY sort_order', []))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.capability_key));
  const out: Capability[] = [];
  for (const key of keys) {
    const c = await capability(key);
    if (c) out.push(c);
  }
  return out;
}

/**
 * MATURITY MOVES ONLY THIS WAY: a witnessed change, with the evidence and which
 * world it came from. The table refuses reality-proven on rehearsal evidence
 * and refuses a direct update of the column.
 */
export async function recordMaturity(input: {
  providerId: string; to: Maturity; evidence: string;
  evidenceMode: 'real' | 'sandbox' | 'reference'; witnessedBy: string;
}): Promise<void> {
  const row = (await query('SELECT maturity FROM capability_providers WHERE id = ?',
    [input.providerId])).rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('no such provider');
  await query(
    `INSERT INTO capability_maturity_changes
       (id, provider_id, from_maturity, to_maturity, evidence, evidence_mode, witnessed_by)
     VALUES (?,?,?,?,?,?,?)`,
    [nanoid(), input.providerId, String(row.maturity), input.to, input.evidence.trim(),
      input.evidenceMode, input.witnessedBy.trim()]);
}

// ─── what a piece of work would take ─────────────────────────────────────────

export type NeedSubject = 'opportunity' | 'responsibility' | 'proposed_act' | 'experiment' | 'company';

export async function noteNeed(input: {
  founderId: string; subjectKind: NeedSubject; subjectId: string;
  capabilityKey: string; why: string;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO capability_needs (id, founder_id, subject_kind, subject_id, capability_key, why)
       VALUES (?,?,?,?,?,?)`,
      [nanoid(), input.founderId, input.subjectKind, input.subjectId, input.capabilityKey,
        input.why.trim()]);
  } catch { /* already noted */ }
}

export interface Need {
  capability: Capability; why: string;
  standing: 'met' | 'missing' | 'acquirable' | 'owner';
  /** The one sentence: what Foundry can do about it. */
  sentence: string;
  /** How a missing one could be obtained, in order of preference. */
  routes: string[];
}

/**
 * WHAT IT WOULD TAKE, for a thing that needs capabilities.
 *
 * met       a provider exists at controlled-proven or better
 * acquirable a provider is declared or available, or a route to one exists
 * missing   nothing supplies it and nothing is declared
 * owner     the rung is legal or destructive: whatever supplies it, the act
 *            is his each time - said here so it is never a surprise later
 *
 * The routes for a missing one are the owner's own list: reuse something the
 * portfolio has, an existing API, a new provider, governed browser work, an
 * adapter, build it, procure it, license it, or a qualified person.
 */
export async function whatItWouldTake(input: {
  subjectKind: NeedSubject; subjectId: string;
}): Promise<Need[]> {
  const rows = (await query(
    `SELECT capability_key, why FROM capability_needs
      WHERE subject_kind = ? AND subject_id = ? AND met_at IS NULL ORDER BY rowid`,
    [input.subjectKind, input.subjectId])).rows as unknown as Array<Record<string, unknown>>;
  const out: Need[] = [];
  for (const r of rows) {
    const c = await capability(String(r.capability_key));
    if (!c) continue;
    const why = String(r.why);
    const best = c.best;
    const provenEnough = best !== null && ORDER[best.maturity] >= ORDER.controlled_proven;
    const ownersRung = c.rung === 'legal' || c.rung === 'destructive';
    const routes = best === null || best.maturity === 'declared'
      ? routesFor(c) : [];
    const standing: Need['standing'] = ownersRung ? 'owner'
      : provenEnough ? 'met'
        : best !== null ? 'acquirable' : 'missing';
    const sentence = standing === 'owner'
      ? `${c.whatItDoes} - I can prepare every part of it, and the act itself is yours each time`
      : standing === 'met'
        ? `${c.whatItDoes} - I can carry this, through ${best?.provider ?? ''} `
          + `(${MATURITY_IN_PLAIN_WORDS[best?.maturity ?? 'declared']}`
          + `${best?.provenBy ? `, witnessed by ${best.provenBy.by}` : ''})`
        : standing === 'acquirable'
          ? `${c.whatItDoes} - I have ${best?.provider ?? 'something'} for this, `
            + `${MATURITY_IN_PLAIN_WORDS[best?.maturity ?? 'declared']}; it would need proving first`
          : `${c.whatItDoes} - I cannot do this yet. ${routes[0] ?? ''}`;
    out.push({ capability: c, why, standing, sentence, routes });
  }
  return out;
}

function routesFor(c: Capability): string[] {
  const routes: string[] = [];
  switch (c.family) {
    case 'research':
      routes.push('a research source I can read through, connected as a way of looking',
        'governed browser work against the public site',
        'a person with the problem, asked with their consent');
      break;
    case 'computer': case 'development': case 'testing': case 'data': case 'design':
      routes.push('an isolated workspace with the tools installed',
        'build it as reusable portfolio infrastructure');
      break;
    case 'deployment': case 'hosting': case 'domains':
      routes.push('an adapter to the provider the portfolio already uses',
        'a new provider, connected through the credential lifecycle');
      break;
    case 'commerce': case 'communication': case 'distribution': case 'experimentation':
    case 'monitoring': case 'customer_operations':
      routes.push('an existing provider API, behind the outbound door',
        'governed browser work where no API exists',
        'a bounded manual version first, to learn whether it is worth automating');
      break;
    case 'procurement': case 'legal_sensing': case 'human_expertise':
      routes.push('a qualified person, briefed with the question and the evidence',
        'a licensed source rather than gathering it ourselves');
      break;
    default:
      routes.push('build it, if the class of work it unlocks is worth it');
  }
  return routes;
}
