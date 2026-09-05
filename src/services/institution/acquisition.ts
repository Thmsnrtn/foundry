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

export interface Economics {
  kind: 'fixed_recurring' | 'trial_credit' | 'included_allowance'
    | 'first_proof_ceiling' | 'variable_usage';
  label: string;
  amountCents: number | null;
  period: 'month' | 'once' | 'per_piece_of_work' | null;
  note: string;
}

export type Route = 'reuse' | 'existing_api' | 'new_provider' | 'browser' | 'adapter'
  | 'build' | 'procure' | 'license' | 'human';

export interface Acquisition {
  id: string; capabilityKey: string; whatItDoes: string; rung: string;
  route: Route; provider: string; how: string; costNote: string; because: string;
  decision: 'approved' | 'declined' | null; acquired: boolean;
  /**
   * THE DISTINCTION, AS TWO LISTS HE CAN READ SIDE BY SIDE.
   *
   * CAPABILITY ACQUISITION IS NOT AUTHORITY TO USE THAT CAPABILITY FOR ANY
   * PURPOSE. One sentence carries that when the capability is small; it does
   * not when the owner is being asked for a recurring bill. Empty when nobody
   * wrote them, and the card falls back to the sentence.
   */
  enables: string[];
  doesNotAuthorize: string[];
  /**
   * THE MONEY, AS SEPARATE FACTS.
   *
   * A recurring commitment and a one-off ceiling are different kinds of thing,
   * and the small number is the reassuring one — so running them together in a
   * sentence reads as cheaper than the truth. Empty when nobody recorded any,
   * and `costNote` is then the whole of it.
   */
  economics: Economics[];
  /**
   * NOTHING CAN CARRY THIS CAPABILITY TODAY.
   *
   * The threshold that earns an owner's first screen. Not "this would be
   * useful" and not "the institution would like it" — no provider of this
   * capability is available or better, so a responsibility that needs it cannot
   * be carried at all until he answers. Being unable to act outranks being
   * allowed to act more widely.
   */
  blocking: boolean;
  /** Set when the owner has taken his yes back. */
  withdrawnAt: string | null;
  withdrawReason: string | null;
  /** The one paragraph he reads. */
  sentence: string;
}

export async function proposeAcquisition(input: {
  founderId: string; capabilityKey: string; route: Route; provider: string;
  how: 'api' | 'browser' | 'shell' | 'workspace' | 'human' | 'internal';
  costNote: string; because: string; proposedBy: string;
  subject?: { kind: 'opportunity' | 'company'; id: string } | null;
  enables?: string[]; doesNotAuthorize?: string[];
  economics?: Economics[];
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
        subject_kind, subject_id, proposed_by, enables, does_not_authorize)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.capabilityKey, input.route, input.provider.trim(), input.how,
      input.costNote.trim(), input.because.trim(), input.subject?.kind ?? null,
      input.subject?.id ?? null, input.proposedBy,
      (input.enables ?? []).join('\n') || null,
      (input.doesNotAuthorize ?? []).join('\n') || null]);

  for (const [i, e] of (input.economics ?? []).entries()) {
    await query(
      `INSERT INTO acquisition_economics
         (id, acquisition_id, founder_id, kind, label, amount_cents, period, note, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [nanoid(), id, input.founderId, e.kind, e.label, e.amountCents, e.period, e.note, i]);
  }
  return id;
}

/**
 * Whether anything could carry this capability as things stand. `declared` does
 * not count: an adapter written against a service nobody has an account with is
 * a claim about code, not a way of doing the work.
 */
async function somethingCanCarry(capabilityKey: string): Promise<boolean> {
  const row = (await query(
    `SELECT COUNT(*) AS n FROM capability_providers
      WHERE capability_key = ?
        AND maturity IN ('available','controlled_proven','reality_proven','reliable')`,
    [capabilityKey])).rows[0] as Record<string, unknown>;
  return Number(row.n) > 0;
}

async function economicsFor(acquisitionId: string): Promise<Economics[]> {
  return ((await query(
    `SELECT kind, label, amount_cents, period, note FROM acquisition_economics
      WHERE acquisition_id = ? ORDER BY sort_order, kind`, [acquisitionId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    kind: String(r.kind) as Economics['kind'],
    label: String(r.label),
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents),
    period: r.period == null ? null : String(r.period) as Economics['period'],
    note: String(r.note),
  }));
}

/** One item per line, so the lists stay readable in the database itself. */
function lines(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split('\n').map((x) => x.trim()).filter((x) => x.length > 0);
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
    because: String(row.because), decision, acquired: row.acquired_at != null,
    enables: lines(row.enables), doesNotAuthorize: lines(row.does_not_authorize),
    economics: await economicsFor(String(row.id)),
    blocking: !(await somethingCanCarry(String(row.capability_key))),
    withdrawnAt: row.withdrawn_at == null ? null : String(row.withdrawn_at),
    withdrawReason: row.withdraw_reason == null ? null : String(row.withdraw_reason),
    sentence,
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
    `SELECT * FROM capability_acquisitions
      WHERE founder_id = ? AND decision IS NULL AND withdrawn_at IS NULL
      ORDER BY proposed_at`, [founderId])).rows as unknown as Array<Record<string, unknown>>;
  const out: Acquisition[] = [];
  for (const r of rows) out.push(await read(r));
  return out;
}

/**
 * WHAT HE IS ACTUALLY CARRYING, so that taking it back is somewhere he can find
 * it rather than a promise made once on a card he has scrolled past.
 */
export async function acquisitionsHeld(founderId: string): Promise<Acquisition[]> {
  const rows = (await query(
    `SELECT * FROM capability_acquisitions
      WHERE founder_id = ? AND decision = 'approved' AND withdrawn_at IS NULL
      ORDER BY decided_at`, [founderId])).rows as unknown as Array<Record<string, unknown>>;
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
  if (input.decision !== 'approved') return;

  // THE SECOND GRANT, WRITTEN WHERE THE FIRST ONE IS ANSWERED.
  //
  // He read two numbers on the card: a subscription and a ceiling on metered
  // use above it. Recording only the first would make the second a sentence he
  // was shown, which is worse than not showing it — so the yes writes both, and
  // the ceiling is read where workspaces are made.
  //
  // The lowest ceiling wins if one is already there. Approving a second
  // capability must not quietly raise a limit he set answering a different
  // question.
  const row = (await query(
    `SELECT a.founder_id, e.amount_cents
       FROM capability_acquisitions a
       JOIN acquisition_economics e ON e.acquisition_id = a.id
      WHERE a.id = ? AND e.kind = 'variable_usage' AND e.period = 'month'
        AND e.amount_cents IS NOT NULL`,
    [input.id])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return;

  const existing = (await query(
    'SELECT cents_per_month FROM workshop_spend_ceiling WHERE founder_id = ?',
    [String(row.founder_id)])).rows[0] as Record<string, unknown> | undefined;
  if (existing && Number(existing.cents_per_month) <= Number(row.amount_cents)) return;
  await query('DELETE FROM workshop_spend_ceiling WHERE founder_id = ?',
    [String(row.founder_id)]);
  await query(
    `INSERT INTO workshop_spend_ceiling
       (founder_id, cents_per_month, acquisition_id, authorized_by)
     VALUES (?,?,?,?)`,
    [String(row.founder_id), Number(row.amount_cents), input.id, input.by]);
}

/**
 * HE TAKES HIS YES BACK.
 *
 * WHAT THIS REACHES AND WHAT IT DOES NOT. It stops the institution using the
 * provider — the row moves to `unavailable`, and from that moment everything
 * asking what a piece of work would take gets the truth rather than a
 * capability the owner has stopped wanting. It cancels nothing at the provider:
 * a subscription lives in his own account and only he can end it. Saying so is
 * the whole point; a withdrawal that quietly implied it had stopped the billing
 * would be worse than none.
 */
export async function withdrawAcquisition(input: {
  id: string; reason: string; by: string;
}): Promise<void> {
  const a = (await query(
    `SELECT provider_id, decision, withdrawn_at FROM capability_acquisitions WHERE id = ?`,
    [input.id])).rows[0] as Record<string, unknown> | undefined;
  if (!a) throw new Error('no such acquisition');
  if (String(a.decision) !== 'approved') throw new Error('capability_acquisition:nothing_to_withdraw');
  if (a.withdrawn_at != null) return;

  await query(
    `UPDATE capability_acquisitions
        SET withdrawn_at = datetime('now'), withdraw_reason = ?
      WHERE id = ? AND withdrawn_at IS NULL`, [input.reason.trim(), input.id]);

  // The ceiling this decision wrote goes with it. Leaving it behind would let a
  // withdrawn decision go on governing spending it no longer authorises.
  await query('DELETE FROM workshop_spend_ceiling WHERE acquisition_id = ?', [input.id]);

  if (a.provider_id != null) {
    await recordMaturity({
      providerId: String(a.provider_id), to: 'unavailable',
      evidence: `the owner withdrew this: ${input.reason.trim()}`,
      evidenceMode: 'real', witnessedBy: input.by,
    });
  }
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

  // A PROVIDER THIS INSTITUTION ALREADY DESCRIBES IS NOT ACQUIRED TWICE.
  //
  // An adapter can be written before the owner is ever asked to pay for the
  // service behind it — which is the right order, because a card that asks for
  // money before anything could use it is asking him to fund a hope. But the
  // acquisition then arrives at a capability that already has this provider
  // declared, and inserting a second row would leave the fabric describing one
  // real thing twice, with two maturities that drift apart.
  const existing = (await query(
    `SELECT id FROM capability_providers WHERE capability_key = ? AND provider = ?`,
    [String(a.capability_key), String(a.provider)])).rows[0] as Record<string, unknown> | undefined;
  const providerId = existing ? String(existing.id) : nanoid();
  if (!existing) {
    await query(
      `INSERT INTO capability_providers (id, capability_key, provider, how, tool, cost_note, maturity)
       VALUES (?,?,?,?,?,?,'declared')`,
      [providerId, String(a.capability_key), String(a.provider), String(a.how), input.tool ?? null,
        String(a.cost_note)]);
  }
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
