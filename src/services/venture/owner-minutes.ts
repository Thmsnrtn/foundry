// =============================================================================
// FOUNDRY — the owner's own minutes on a test, as he entered them.
//
// Roadmap D6. Every figure Foundry gives about a test is money; the one cost
// it cannot see is the time he pays himself, and Proof 3 asks for it. So he
// may enter it — on the test, on the day he spent it — and what he has not
// entered is said as not entered. Never zero: a month with nothing typed in is
// not a month that cost nothing.
//
// Only the person whose test it is enters time on it; the table itself refuses
// an entry from anybody else (migration 360). Nothing here is inferred from
// activity: a page he opened is not a minute he spent.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { HandRefused } from './hand.js';

export interface MinutesEntry { id: string; onDay: string; minutes: number; what: string | null }

export interface MinutesOn {
  /** Minutes entered and not withdrawn. */
  total: number;
  /** Distinct days with an entry. Every other day is unknown. */
  days: number;
  firstDay: string;
  lastDay: string;
  entries: MinutesEntry[];
}

async function ownerOfTest(experimentId: string): Promise<string | null> {
  const r = (await query('SELECT founder_id FROM venture_experiments WHERE id = ?', [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  return r ? String(r.founder_id) : null;
}

export async function recordOwnerMinutes(input: {
  founderId: string; experimentId: string; onDay: string; minutes: number; what: string | null;
}): Promise<{ id: string }> {
  if (await ownerOfTest(input.experimentId) !== input.founderId) {
    throw new HandRefused('not_yours', 'only the person whose test it is can enter time on it');
  }
  const day = input.onDay.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    throw new HandRefused('bad_date', 'the day needs to be a date, as YYYY-MM-DD');
  }
  if (day > new Date().toISOString().slice(0, 10)) {
    throw new HandRefused('future_day', 'time is entered for a day already lived, not one in the future');
  }
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) {
    throw new HandRefused('bad_minutes', 'minutes are a whole number from 1 to 1440, a day\'s worth');
  }
  const what = input.what?.trim() ? input.what.trim().slice(0, 500) : null;
  const id = nanoid();
  await query(
    `INSERT INTO owner_minutes (id, founder_id, experiment_id, on_day, minutes, what)
     VALUES (?,?,?,?,?,?)`,
    [id, input.founderId, input.experimentId, day, input.minutes, what]);
  return { id };
}

/** Withdraw a mistaken entry: once, by its author, and it stays on record. */
export async function withdrawOwnerMinutes(input: { founderId: string; entryId: string }): Promise<void> {
  const r = (await query('SELECT founder_id, withdrawn_at FROM owner_minutes WHERE id = ?', [input.entryId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!r || String(r.founder_id) !== input.founderId) throw new HandRefused('not_yours', 'there is no such entry of yours');
  if (r.withdrawn_at != null) throw new HandRefused('already_withdrawn', 'that entry was already withdrawn');
  await query(`UPDATE owner_minutes SET withdrawn_at = datetime('now') WHERE id = ?`, [input.entryId]);
}

/** What he has entered on a test, or null when he has entered nothing. */
export async function minutesOn(experimentId: string): Promise<MinutesOn | null> {
  const rows = (await query(
    `SELECT id, on_day, minutes, what FROM owner_minutes
      WHERE experiment_id = ? AND withdrawn_at IS NULL ORDER BY on_day, entered_at`, [experimentId]))
    .rows as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const entries = rows.map((r) => ({ id: String(r.id), onDay: String(r.on_day), minutes: Number(r.minutes),
    what: r.what == null ? null : String(r.what) }));
  return {
    total: entries.reduce((s, e) => s + e.minutes, 0),
    days: new Set(entries.map((e) => e.onDay)).size,
    firstDay: entries[0].onDay, lastDay: entries[entries.length - 1].onDay, entries,
  };
}
