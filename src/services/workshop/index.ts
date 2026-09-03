// =============================================================================
// FOUNDRY - the workshop, governed
//
// Where a piece of work gets a computer, and the one rule that computer lives
// under: it may never possess more consequential authority than the task that
// created it. The ceiling is set at creation and immutable; every grant is
// checked against it by the database; a step that uses a capability it was not
// granted is refused and the refusal is on the record.
//
// A WORKSHOP IS SUBORDINATE TO THE SAME DOOR AS EVERYTHING ELSE. Nothing in
// here sends, spends or publishes. A step that needs to leaves the workshop as
// a proposed act and comes back, if at all, as an approval - and the outbound
// door checks the rung whichever way the request arrives.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import type { Substrate, WorkshopSpec, WorkshopSubstrate } from './contract.js';
import { WorkshopError } from './contract.js';

async function substrate(name: Substrate): Promise<WorkshopSubstrate> {
  if (name === 'reference_world') return (await import('./reference.js')).referenceWorkshop;
  if (name === 'local_process') return (await import('./local-process.js')).localProcessWorkshop;
  if (name === 'fly_machines') return (await import('./fly-machines.js')).flyMachinesWorkshop;
  throw new WorkshopError(name, 'substrate', `no adapter for ${name}: it is declared, not available`);
}

async function ownerOf(workspaceId: string): Promise<string> {
  const row = (await query('SELECT founder_id FROM workspaces WHERE id = ?', [workspaceId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('no such workshop');
  return String(row.founder_id);
}

async function event(workspaceId: string, kind: string, detail: string, costCents = 0): Promise<void> {
  await query(
    `INSERT INTO workspace_events (id, workspace_id, founder_id, kind, detail, cost_cents)
     VALUES (?,?,?,?,?,?)`,
    [nanoid(), workspaceId, await ownerOf(workspaceId), kind, detail.trim() || kind, costCents]);
  if (costCents > 0) {
    await query('UPDATE workspaces SET spent_cents = spent_cents + ? WHERE id = ?',
      [costCents, workspaceId]);
  }
}

export interface Workshop {
  id: string; purpose: string; ceiling: string; substrate: Substrate;
  externalRef: string | null; budgetCents: number; spentCents: number;
  granted: string[];
  /** Each live grant with who made it - a grant nobody can attribute is a grant nobody made. */
  grants: Array<{ capabilityKey: string; grantedBy: string }>;
  asleep: boolean; destroyed: boolean;
}

export async function createWorkshop(input: {
  founderId: string; purpose: WorkshopSpec['purpose']; ceiling: WorkshopSpec['ceiling'];
  network?: WorkshopSpec['network']; budgetCents?: number; tooling?: string[];
  subject?: { kind: 'opportunity' | 'company'; id: string } | null;
  substrate: Substrate; createdBy: string;
  evidenceMode: 'real' | 'reference';
}): Promise<Workshop> {
  // THE REHEARSAL SUBSTRATE IS FOR REHEARSALS. A real task on the in-process
  // computer would be pretending to have done work.
  //
  // The other direction is deliberately NOT refused any more. A real computer
  // doing rehearsal work is exactly how the workshop lifecycle earns its
  // reality: files really written, commands really run, cost really incurred,
  // teardown really removing it - on work that could not matter if it went
  // wrong. Refusing that would have left the only proven substrate the one
  // that executes nothing.
  if (input.substrate === 'reference_world' && input.evidenceMode !== 'reference') {
    throw new WorkshopError(input.substrate, 'create',
      'the rehearsal substrate executes nothing, so real work cannot happen in it');
  }
  const id = nanoid();
  await query(
    `INSERT INTO workspaces
       (id, founder_id, purpose, subject_kind, subject_id, substrate, ceiling, network,
        budget_cents, evidence_mode, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.purpose, input.subject?.kind ?? null, input.subject?.id ?? null,
      input.substrate, input.ceiling, input.network ?? 'none', input.budgetCents ?? 0,
      input.evidenceMode, input.createdBy]);
  const sub = await substrate(input.substrate);
  const made = await sub.create({
    purpose: input.purpose, ceiling: input.ceiling, network: input.network ?? 'none',
    budgetCents: input.budgetCents ?? 0, tooling: input.tooling ?? [],
  });
  await query('UPDATE workspaces SET external_ref = ? WHERE id = ?', [made.externalRef, id]);
  await event(id, 'created', `${input.purpose} on ${input.substrate}, ceiling ${input.ceiling}`,
    made.costCents);
  return read(id);
}

export async function read(id: string): Promise<Workshop> {
  const w = (await query(
    `SELECT id, purpose, ceiling, substrate, external_ref, budget_cents, spent_cents,
            slept_at, destroyed_at FROM workspaces WHERE id = ?`, [id]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!w) throw new Error('no such workshop');
  const grants = ((await query(
    `SELECT capability_key, granted_by FROM workspace_grants
      WHERE workspace_id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`, [id]))
    .rows as unknown as Array<Record<string, unknown>>).map((g) => ({
    capabilityKey: String(g.capability_key), grantedBy: String(g.granted_by),
  }));
  return {
    id, purpose: String(w.purpose), ceiling: String(w.ceiling),
    substrate: String(w.substrate) as Substrate,
    externalRef: w.external_ref == null ? null : String(w.external_ref),
    budgetCents: Number(w.budget_cents), spentCents: Number(w.spent_cents),
    granted: grants.map((g) => g.capabilityKey), grants,
    asleep: w.slept_at != null, destroyed: w.destroyed_at != null,
  };
}

/**
 * GRANT A CAPABILITY, NEVER A CREDENTIAL. The database refuses a grant above
 * the ceiling; this function only reports it in the owner's words.
 */
export async function grant(input: {
  workshopId: string; capabilityKey: string; grantedBy: string; expiresAt?: Date | null;
}): Promise<{ granted: boolean; because: string }> {
  try {
    await query(
      `INSERT INTO workspace_grants (id, workspace_id, founder_id, capability_key, granted_by, expires_at)
       VALUES (?,?,?,?,?,?)`,
      [nanoid(), input.workshopId, await ownerOf(input.workshopId), input.capabilityKey,
        input.grantedBy, input.expiresAt?.toISOString() ?? null]);
  } catch (err) {
    const message = String((err as Error).message);
    const because = message.includes('above_the_ceiling')
      ? `${input.capabilityKey} is more consequential than this workshop was made for. `
        + 'If the work needs it, that is a proposal to you, not a grant to the computer.'
      : message.includes('workspace_is_gone') ? 'that workshop is gone'
        : `already granted, or refused: ${message}`;
    await event(input.workshopId, 'refused', `grant of ${input.capabilityKey}: ${because}`);
    return { granted: false, because };
  }
  await event(input.workshopId, 'granted', `${input.capabilityKey} by ${input.grantedBy}`);
  return { granted: true, because: 'within the ceiling' };
}

export async function revoke(input: { workshopId: string; capabilityKey: string; reason: string }): Promise<void> {
  await query(
    `UPDATE workspace_grants SET revoked_at = datetime('now'), revoke_reason = ?
      WHERE workspace_id = ? AND capability_key = ? AND revoked_at IS NULL`,
    [input.reason, input.workshopId, input.capabilityKey]);
  await event(input.workshopId, 'revoked', `${input.capabilityKey}: ${input.reason}`);
}

/** Run one step, under the grants that are live right now. */
export async function run(input: { workshopId: string; step: string }): Promise<{
  ok: boolean; output: string;
}> {
  const w = await read(input.workshopId);
  if (w.destroyed || !w.externalRef) throw new Error('that workshop is gone');
  if (w.spentCents >= w.budgetCents && w.budgetCents > 0) {
    await event(w.id, 'refused', 'the budget is spent');
    return { ok: false, output: 'refused: the budget for this workshop is spent' };
  }
  const sub = await substrate(w.substrate);
  const result = await sub.run(w.externalRef, input.step, w.granted);
  await event(w.id, result.ok ? 'ran' : 'refused', `${input.step} -> ${result.output}`, result.costCents);
  return { ok: result.ok, output: result.output };
}

export async function checkpoint(input: { workshopId: string; label: string }): Promise<string> {
  const w = await read(input.workshopId);
  if (!w.externalRef) throw new Error('that workshop is gone');
  const sub = await substrate(w.substrate);
  const made = await sub.checkpoint(w.externalRef, input.label);
  await event(w.id, 'checkpointed', input.label, made.costCents);
  return made.checkpointRef;
}

export async function restore(input: { workshopId: string; checkpointRef: string }): Promise<void> {
  const w = await read(input.workshopId);
  if (!w.externalRef) throw new Error('that workshop is gone');
  const sub = await substrate(w.substrate);
  const done = await sub.restore(w.externalRef, input.checkpointRef);
  await event(w.id, 'restored', input.checkpointRef, done.costCents);
}

export async function sleep(workshopId: string): Promise<void> {
  const w = await read(workshopId);
  if (!w.externalRef) throw new Error('that workshop is gone');
  await (await substrate(w.substrate)).sleep(w.externalRef);
  await query("UPDATE workspaces SET slept_at = datetime('now') WHERE id = ?", [workshopId]);
  await event(workshopId, 'slept', 'idle');
}

export async function wake(workshopId: string): Promise<void> {
  const w = await read(workshopId);
  if (!w.externalRef) throw new Error('that workshop is gone');
  await (await substrate(w.substrate)).wake(w.externalRef);
  await query('UPDATE workspaces SET slept_at = NULL WHERE id = ?', [workshopId]);
  await event(workshopId, 'woke', 'resumed');
}

/**
 * DESTROY, KEEPING WHAT MATTERED. The table refuses destruction with nothing
 * preserved - "nothing worth keeping" is itself a thing to say.
 */
export async function destroy(input: { workshopId: string; preserved: string }): Promise<void> {
  const w = await read(input.workshopId);
  if (!w.externalRef) throw new Error('that workshop is gone');
  const done = await (await substrate(w.substrate)).destroy(w.externalRef);
  // THE TEARDOWN'S OWN COST, CHARGED IN THE SAME BREATH AS THE DESTRUCTION.
  // Recording the event afterwards tried to add the cost to a row the guard had
  // just closed, so a real workshop could never account for what removing it
  // took — the one substrate where teardown is not free is the one where it
  // could not be recorded.
  await query(
    `UPDATE workspaces SET destroyed_at = datetime('now'), preserved = ?,
            spent_cents = spent_cents + ? WHERE id = ?`,
    [input.preserved.trim(), done.costCents, input.workshopId]);
  await query(
    `INSERT INTO workspace_events (id, workspace_id, founder_id, kind, detail, cost_cents)
     VALUES (?,?,?,'destroyed',?,?)`,
    [nanoid(), input.workshopId, await ownerOf(input.workshopId),
      `kept: ${input.preserved.trim()}`, done.costCents]);
}

/**
 * ONLY WHAT THE WORK REQUIRES, AND NOT ONE THING MORE.
 *
 * Hand-granting is how least privilege quietly stops being least: whoever sets
 * a workshop up adds what they think it might want, and nobody ever removes
 * any of it. So the grants come from the DECLARED NEEDS of the thing being
 * worked on - the same `capability_needs` rows the institution answers "what
 * would this take" from - and nothing else is granted at all.
 *
 * AND WHAT IT COULD NOT GRANT IS REPORTED, NEVER SWALLOWED. A need above the
 * ceiling is not a smaller workshop quietly proceeding without it; it is a
 * sentence saying the work cannot be finished in here, which is either a
 * different workshop or a proposal to the owner.
 */
export async function provisionFor(input: {
  workshopId: string; subjectKind: 'opportunity' | 'company'; subjectId: string;
  grantedBy: string;
}): Promise<{ granted: string[]; refused: Array<{ capabilityKey: string; because: string }> }> {
  const { whatItWouldTake } = await import('../institution/capabilities.js');
  const needs = await whatItWouldTake({
    subjectKind: input.subjectKind, subjectId: input.subjectId });

  const granted: string[] = [];
  const refused: Array<{ capabilityKey: string; because: string }> = [];
  for (const need of needs) {
    // A capability nothing can supply is not a grant problem. Granting it would
    // put a name on a workshop that could not use it, and hide the real answer,
    // which is that something has to be acquired first.
    if (need.standing === 'missing') {
      refused.push({ capabilityKey: need.capability.key,
        because: 'nothing supplies this yet — it has to be acquired before any '
          + 'workshop could use it' });
      continue;
    }
    const made = await grant({
      workshopId: input.workshopId, capabilityKey: need.capability.key,
      grantedBy: input.grantedBy });
    if (made.granted) granted.push(need.capability.key);
    else refused.push({ capabilityKey: need.capability.key, because: made.because });
  }
  return { granted, refused };
}

/** What happened in there, for the record and for the owner's letter. */
export async function history(workshopId: string): Promise<Array<{
  kind: string; detail: string; costCents: number; at: string;
}>> {
  return ((await query(
    `SELECT kind, detail, cost_cents, at FROM workspace_events
      WHERE workspace_id = ? ORDER BY at, rowid`, [workshopId]))
    .rows as unknown as Array<Record<string, unknown>>).map((e) => ({
    kind: String(e.kind), detail: String(e.detail), costCents: Number(e.cost_cents),
    at: String(e.at),
  }));
}

/**
 * A WORKSHOP FOR A TEST HE APPROVED.
 *
 * When an experiment is approved and involves making something - a landing
 * page, a sample dataset, a prototype - the work needs a computer, and it
 * gets one under a PREPARE ceiling: it may build and render, and nothing it
 * makes reaches the world until a separate act does, through the door.
 *
 * A rehearsal experiment gets the rehearsal computer. A real one gets a real
 * computer only when a real substrate is available; until then this says so
 * rather than pretending, and the experiment stays approved for a person to
 * carry.
 */
export async function workshopFor(experimentId: string): Promise<{
  opened: boolean; workshopId: string | null; because: string;
}> {
  const e = (await query(
    `SELECT founder_id, opportunity_id, what_we_do, evidence_mode, decision
       FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e || String(e.decision) !== 'approved') {
    return { opened: false, workshopId: null, because: 'the experiment is not approved' };
  }
  const reference = String(e.evidence_mode) === 'reference';
  try {
    const w = await createWorkshop({
      founderId: String(e.founder_id), purpose: 'venture_development', ceiling: 'prepare',
      budgetCents: reference ? 100 : 0,
      subject: { kind: 'opportunity', id: String(e.opportunity_id) },
      substrate: reference ? 'reference_world' : 'fly_machines',
      createdBy: `experiment:${experimentId}`,
      evidenceMode: reference ? 'reference' : 'real',
    });
    await grant({ workshopId: w.id, capabilityKey: 'write_code_in_branch', grantedBy: `experiment:${experimentId}` });
    await grant({ workshopId: w.id, capabilityKey: 'render_screen', grantedBy: `experiment:${experimentId}` });
    return { opened: true, workshopId: w.id, because: `a workshop for: ${String(e.what_we_do)}` };
  } catch (err) {
    return {
      opened: false, workshopId: null,
      because: err instanceof WorkshopError ? err.message : String((err as Error).message),
    };
  }
}
