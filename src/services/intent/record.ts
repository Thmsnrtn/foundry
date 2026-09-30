// =============================================================================
// FOUNDRY — the record of what the owner said and what Foundry understood.
//
// One row per sentence shown (migration 370). Written when the composer shows
// its reading; settled once, when the owner confirms, is answered, or is taken
// where he asked to go. Read back as the one measure of the composer that
// matters to him: how often it understood, and what it did not.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { touchesAuthority, type IntentProposal } from './compile.js';

type Row = Record<string, unknown>;

/** Keep the reading that was shown. Returns the row's id. */
export async function recordShown(founderId: string, p: IntentProposal): Promise<string> {
  // A DOUBLE TAP IS ONE SENTENCE. The same reading shown again within a
  // minute and not yet settled is the same row, not a second thing he said.
  const again = (await query(
    `SELECT id FROM owner_intents WHERE founder_id = ? AND reading_hash = ? AND outcome IS NULL
        AND shown_at >= datetime('now', '-1 minute') ORDER BY shown_at DESC, rowid DESC LIMIT 1`,
    [founderId, p.hash])).rows[0] as Row | undefined;
  if (again) return String(again.id);
  const id = `oi_${nanoid(12)}`;
  const outcome = p.kind === 'question' ? 'answered' : p.kind === 'jump' ? 'went' : null;
  await query(
    `INSERT INTO owner_intents (id, founder_id, said, scope, kind, understood_as, touches_authority, reading_hash, outcome, outcome_at)
     VALUES (?,?,?,?,?,?,?,?,?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`,
    [id, founderId, p.said, p.scope.kind === 'company' && p.scope.id ? `company:${p.scope.id}` : 'none', p.kind,
      p.understoodAs.slice(0, 300), touchesAuthority(p) ? 1 : 0, p.hash, outcome, outcome]);
  return id;
}

/**
 * THE OWNER CONFIRMED WHAT HE WAS SHOWN. Settles the latest unsettled reading
 * of exactly these words from the last day; a reading already settled is left
 * as it was (the schema refuses a second outcome).
 */
export async function recordConfirmed(founderId: string, said: string): Promise<void> {
  await query(
    `UPDATE owner_intents SET outcome = 'confirmed', outcome_at = datetime('now')
      WHERE id = (SELECT id FROM owner_intents
                   WHERE founder_id = ? AND said = ? AND outcome IS NULL AND shown_at >= datetime('now', '-1 day')
                   ORDER BY shown_at DESC, rowid DESC LIMIT 1)`,
    [founderId, said.trim().slice(0, 800)]);
}

export interface Understanding {
  days: number;
  said: number;
  answered: number;
  went: number;
  confirmed: number;
  /** Shown, needing his word, and not confirmed within a day. */
  leftAlone: number;
  /** Not understood at all, or understood only well enough to ask which. */
  notUnderstood: number;
  askedWhich: number;
  touchedAuthority: number;
  /** How long, typically, between being shown a reading and confirming it; null before the first. */
  typicalMinutesToConfirm: number | null;
  /** The most recent sentences Foundry could not place, verbatim, newest first. */
  missed: Array<{ said: string; at: string }>;
}

/** How well Foundry understood him, from the rows. */
export async function howWellIUnderstand(founderId: string, days = 30): Promise<Understanding> {
  const rows = (await query(
    `SELECT kind, outcome, touches_authority, shown_at, outcome_at FROM owner_intents
      WHERE founder_id = ? AND shown_at >= datetime('now', ?)`, [founderId, `-${String(days)} days`])).rows as unknown as Row[];
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  const missed = ((await query(
    `SELECT said, shown_at FROM owner_intents WHERE founder_id = ? AND kind = 'unplaceable'
      ORDER BY shown_at DESC, rowid DESC LIMIT 5`, [founderId])).rows as unknown as Row[])
    .map((r) => ({ said: String(r.said), at: String(r.shown_at) }));
  const needsWord = (k: string): boolean => !['question', 'jump', 'clarify', 'unplaceable'].includes(k);
  const asMs = (t: unknown): number => Date.parse(`${String(t).replace(' ', 'T')}Z`);
  const waits = rows.filter((r) => r.outcome === 'confirmed' && r.outcome_at != null)
    .map((r) => (asMs(r.outcome_at) - asMs(r.shown_at)) / 60_000).filter((m) => Number.isFinite(m) && m >= 0).sort((a, b) => a - b);
  return {
    days, said: rows.length,
    answered: rows.filter((r) => r.outcome === 'answered').length,
    went: rows.filter((r) => r.outcome === 'went').length,
    confirmed: rows.filter((r) => r.outcome === 'confirmed').length,
    leftAlone: rows.filter((r) => needsWord(String(r.kind)) && r.outcome == null && String(r.shown_at) < dayAgo).length,
    notUnderstood: rows.filter((r) => r.kind === 'unplaceable').length,
    askedWhich: rows.filter((r) => r.kind === 'clarify').length,
    touchedAuthority: rows.filter((r) => Number(r.touches_authority) === 1).length,
    typicalMinutesToConfirm: waits.length ? Math.round(waits[Math.floor(waits.length / 2)]!) : null,
    missed,
  };
}
