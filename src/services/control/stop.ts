// =============================================================================
// FOUNDRY — Stop everything, meaning everything.
//
// INSTITUTION_MODEL §11 V6 (30 September 2026). The button on Control said it
// "halts every routine, every permission and every outgoing action at once",
// and it stopped the routines of ONE company — whichever the request happened
// to resolve. An owner with three companies pressed Stop and two carried on.
// This is the estate-wide act the button always described:
//
//   - every company the owner owns: its routines to watching and the consent
//     behind them withdrawn (the existing `panicStop`, per company);
//   - new outgoing activity paused (the Workshop's own pause), so nothing new
//     reaches a person while stopped;
//   - every Mission the owner stated that is running, paused.
//
// It leaves an append-only record of itself (`estate_stopped` in audit_log),
// read back by `pauseHistory` on the Workshop page, so Resume cannot erase it.
//
// ONLY EVER LOWERS. Nothing here grants, resumes or widens. Undoing it is per
// item, where each thing lives, because "start everything again" is not one
// decision.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export interface Stopped {
  companies: number;
  routines: number;
  outreachPaused: boolean;
  missionsPaused: number;
}

export async function stopEverything(founderId: string, reason = 'the owner pressed Stop everything'): Promise<Stopped> {
  const { panicStop } = await import('../autopilot/policy.js');
  // IDENTITY, NOT TRUTH: every company the owner owns, invented ones included;
  // stopping a rehearsal's routines lowers nothing that matters and leaves
  // nothing running that the button said it stopped.
  const companies = (await query(
    `SELECT id FROM products WHERE owner_id = ? AND deleted_at IS NULL ORDER BY rowid`, [founderId])).rows as unknown as Array<{ id: string }>;
  let routines = 0;
  for (const p of companies) routines += await panicStop(String(p.id), founderId);

  let outreachPaused = false;
  const workshop = (await query(`SELECT economic_pause_at FROM public_workshop WHERE founder_id = ?`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  if (workshop) {
    const { pauseNewEconomicActivity } = await import('../public-workshop/settings.js');
    await pauseNewEconomicActivity({ founderId, reason });
    outreachPaused = true;
  }

  const { missionsOf } = await import('../mission/read.js');
  const { actOnMission } = await import('../mission/write.js');
  let missionsPaused = 0;
  for (const m of await missionsOf(founderId)) {
    if (m.source !== 'mission' || m.concluded || m.status === 'paused' || m.status === 'draft') continue;
    await actOnMission(founderId, m.key, 'paused', reason);
    missionsPaused += 1;
  }
  // THE STOP IS A RECORD, NOT ONLY A STATE (F-PANIC-2). Every lowering above
  // is undone item by item, and Resume clears the Workshop's pause columns, so
  // without this nothing would say the estate was ever stopped. One
  // append-only row per company it touched, in the institution's audit log,
  // under one stop id so a reader counts one act.
  const stopId = nanoid();
  const principal = `founder:${founderId}`;
  const { insertAuditLog } = await import('../../db/client.js');
  const what = { principal, reason, stopId, companies: companies.length, routines, outreachPaused, missionsPaused };
  for (const p of companies) {
    await insertAuditLog({ id: nanoid(), product_id: String(p.id), action_type: 'estate_stopped', gate: 3, trigger: 'owner',
      reasoning: `Stop everything, by ${principal}: ${reason}`, input_context: JSON.stringify(what), outcome: 'recorded' });
  }
  return { companies: companies.length, routines, outreachPaused, missionsPaused };
}
