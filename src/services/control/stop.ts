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
// ONLY EVER LOWERS. Nothing here grants, resumes or widens. Undoing it is per
// item, where each thing lives, because "start everything again" is not one
// decision.
// =============================================================================

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
  return { companies: companies.length, routines, outreachPaused, missionsPaused };
}
