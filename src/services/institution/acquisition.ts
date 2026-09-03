// =============================================================================
// FOUNDRY - acquiring a capability is an act, and it has a door
//
// "I know what should happen but I cannot currently do it" is not a stop. It
// is a proposal: the capability, the route, the provider it would bring in,
// what that costs, and why - put to the owner once, with the consequence rung
// the acquired capability would sit on, so he decides with the whole picture.
//
// APPROVAL MAKES A PROVIDER AVAILABLE. IT GRANTS NO ACT. The acquired
// capability goes through the same outbound door, on the same rung, under the
// same boundaries and allowances as everything else. Acquiring a way to send
// mail is not permission to send one, and the door does not know or care that
// the provider is new.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { capability, recordMaturity } from './capabilities.js';

export type Route = 'reuse' | 'existing_api' | 'new_provider' | 'browser' | 'adapter'
  | 'build' | 'procure' | 'license' | 'human';

export interface Acquisition {
  id: string; capabilityKey: string; whatItDoes: string; rung: string;
  route: Route; provider: string; how: string; costNote: string; because: string;
  decision: 'approved' | 'declined' | null; acquired: boolean;
  /** The one paragraph he reads. */
  sentence: string;
}

export async function proposeAcquisition(input: {
  founderId: string; capabilityKey: string; route: Route; provider: string;
  how: 'api' | 'browser' | 'shell' | 'workspace' | 'human' | 'internal';
  costNote: string; because: string; proposedBy: string;
  subject?: { kind: 'opportunity' | 'company'; id: string } | null;
}): Promise<string> {
  // ONE OPEN PROPOSAL PER CAPABILITY PER PERSON. Asking twice for the same
  // thing is how an owner learns to stop reading.
  const open = (await query(
    `SELECT id FROM capability_acquisitions
      WHERE founder_id = ? AND capability_key = ? AND decision IS NULL`,
    [input.founderId, input.capabilityKey])).rows[0] as Record<string, unknown> | undefined;
  if (open) return String(open.id);
  const id = nanoid();
  await query(
    `INSERT INTO capability_acquisitions
       (id, founder_id, capability_key, route, provider, how, cost_note, because,
        subject_kind, subject_id, proposed_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.capabilityKey, input.route, input.provider.trim(), input.how,
      input.costNote.trim(), input.because.trim(), input.subject?.kind ?? null,
      input.subject?.id ?? null, input.proposedBy]);
  return id;
}

async function read(row: Record<string, unknown>): Promise<Acquisition> {
  const c = await capability(String(row.capability_key));
  const rung = c?.rung ?? 'observe';
  const decision = row.decision == null ? null : String(row.decision) as 'approved' | 'declined';
  const sentence = `${c?.whatItDoes ?? String(row.capability_key)}: I would ${ROUTE_IN_PLAIN_WORDS[String(row.route) as Route]} `
    + `(${String(row.provider)}), which costs ${String(row.cost_note)}. Using it would `
    + `${RUNG_IN_PLAIN_WORDS[rung] ?? rung}. Because ${String(row.because)}.`;
  return {
    id: String(row.id), capabilityKey: String(row.capability_key),
    whatItDoes: c?.whatItDoes ?? '', rung, route: String(row.route) as Route,
    provider: String(row.provider), how: String(row.how), costNote: String(row.cost_note),
    because: String(row.because), decision, acquired: row.acquired_at != null, sentence,
  };
}

export const ROUTE_IN_PLAIN_WORDS: Record<Route, string> = {
  reuse: 'reuse something the portfolio already has',
  existing_api: 'connect a provider that already exists, through the credential lifecycle',
  new_provider: 'bring in a new provider',
  browser: 'do it through a governed browser, with no credential in the workshop',
  adapter: 'write an adapter to a provider',
  build: 'build it as portfolio infrastructure',
  procure: 'pay for a service',
  license: 'license it from somebody',
  human: 'engage a qualified person',
};

const RUNG_IN_PLAIN_WORDS: Record<string, string> = {
  observe: 'only ever look',
  prepare: 'only ever make drafts nobody outside can see',
  reversible: 'change things that can be put back',
  public: 'reach people outside, so your boundaries govern every use',
  financial: 'spend money, so an allowance or your approval governs every use',
  legal: 'commit you to things, so you approve every single use',
  destructive: 'do things that cannot be undone, so you approve every single use',
};

/** What is waiting on him. */
export async function acquisitionsAwaiting(founderId: string): Promise<Acquisition[]> {
  const rows = (await query(
    `SELECT * FROM capability_acquisitions WHERE founder_id = ? AND decision IS NULL
      ORDER BY proposed_at`, [founderId])).rows as unknown as Array<Record<string, unknown>>;
  const out: Acquisition[] = [];
  for (const r of rows) out.push(await read(r));
  return out;
}

export async function decideAcquisition(input: {
  id: string; decision: 'approved' | 'declined'; by: string;
}): Promise<void> {
  await query(
    `UPDATE capability_acquisitions
        SET decision = ?, decided_at = datetime('now'), decided_by = ?
      WHERE id = ? AND decision IS NULL`, [input.decision, input.by, input.id]);
}

/**
 * THE ACQUISITION'S OUTCOME: the provider now exists in the fabric. It arrives
 * declared and is moved to available on the evidence that it was wired - a
 * witnessed change like every other - and the acquisition records which
 * provider it produced. Nothing here is proven; proof is what happens next.
 */
export async function recordAcquired(input: {
  id: string; evidence: string; witnessedBy: string; tool?: string | null;
}): Promise<string> {
  const a = (await query(
    `SELECT capability_key, provider, how, cost_note, decision FROM capability_acquisitions WHERE id = ?`,
    [input.id])).rows[0] as Record<string, unknown> | undefined;
  if (!a) throw new Error('no such acquisition');
  if (String(a.decision) !== 'approved') throw new Error('capability_acquisition:not_approved');
  const providerId = nanoid();
  await query(
    `INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity)
     VALUES (?,?,?,?,?,?,'declared')`,
    [providerId, String(a.capability_key), String(a.provider), String(a.how), input.tool ?? null,
      String(a.cost_note)]);
  await recordMaturity({ providerId, to: 'available', evidence: input.evidence,
    evidenceMode: 'real', witnessedBy: input.witnessedBy });
  await query(
    `UPDATE capability_acquisitions SET acquired_at = datetime('now'), provider_id = ? WHERE id = ?`,
    [providerId, input.id]);
  return providerId;
}

/**
 * FROM A NEED TO A PROPOSAL. For every missing capability a piece of work
 * needs, propose the first route the fabric names, with a provider guessed
 * only where the route implies one - and say so in the provider name, so a
 * guess never reads as a fact.
 */
export async function proposeWhatIsMissing(input: {
  founderId: string; subjectKind: 'opportunity' | 'company'; subjectId: string; proposedBy: string;
}): Promise<string[]> {
  const { whatItWouldTake } = await import('./capabilities.js');
  const needs = await whatItWouldTake({ subjectKind: input.subjectKind, subjectId: input.subjectId });
  const ids: string[] = [];
  for (const need of needs) {
    if (need.standing !== 'missing' && need.standing !== 'acquirable') continue;
    const route = routeFor(need.capability.family);
    ids.push(await proposeAcquisition({
      founderId: input.founderId, capabilityKey: need.capability.key, route,
      provider: need.capability.best?.provider ?? `a provider for ${need.capability.key.replace(/_/g, ' ')} (not yet chosen)`,
      how: need.capability.best?.how as 'api' | 'browser' | 'shell' | 'workspace' | 'human' | 'internal' | undefined
        ?? (route === 'human' ? 'human' : route === 'browser' ? 'browser' : route === 'build' ? 'workspace' : 'api'),
      costNote: need.capability.best?.costNote ?? 'not known until a provider is chosen',
      because: need.why, proposedBy: input.proposedBy,
      subject: { kind: input.subjectKind, id: input.subjectId },
    }));
  }
  return ids;
}

function routeFor(family: string): Route {
  switch (family) {
    case 'research': return 'existing_api';
    case 'computer': case 'development': case 'testing': case 'data': case 'design': return 'build';
    case 'deployment': case 'hosting': case 'domains': return 'adapter';
    case 'procurement': case 'legal_sensing': case 'human_expertise': return 'human';
    default: return 'existing_api';
  }
}
