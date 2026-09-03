// =============================================================================
// FOUNDRY - what changed since you last looked.
//
// The last of the five questions the first screen is supposed to answer. It
// could say whether everything was okay, whether anything needed him, what it
// was doing and how to speak to it, and it had no way at all to say what had
// happened while he was gone — because nothing recorded that he had ever been
// here.
//
// WHAT THIS IS NOT. It is not an activity feed. Foundry runs ninety-five
// routines and none of them are news: "I checked your dependencies" is work,
// not change, and a screen that reported its own diligence would be asking him
// to admire it. What goes here is what an owner would want to know had happened
// while he was away, and nothing else.
//
// It is also deliberately short. If more has changed than fits in a few lines,
// the honest thing is to say how much rather than to list it all — a wall of
// changes is the same failure as a wall of candidates.
// =============================================================================

import { query, realCompany } from '../../db/client.js';

/** How long away counts as having been away. A refresh is not a new visit. */
const A_SEPARATE_VISIT_MINUTES = 30;

/** One statement, on one line, so the column gate can read it as one. */
const UPDATE_THE_MARKER =
  "UPDATE owner_visits SET since = looked_at, looked_at = datetime('now') WHERE founder_id = ?";

export interface Change {
  /** One sentence, in his register, about a thing that actually happened. */
  said: string;
  /** When, so the list can be ordered without inventing importance. */
  at: string;
}

/**
 * WHERE THE LINE IS DRAWN, AND WHY IT HOLDS STILL WHILE HE IS HERE.
 *
 * Returns the point to measure from, then moves the marker if this counts as a
 * separate visit. A first visit has nothing to be measured from and returns
 * null, because "everything that has ever happened" is not what the question
 * means.
 */
export async function markVisit(founderId: string): Promise<string | null> {
  const row = (await query(
    'SELECT looked_at, since FROM owner_visits WHERE founder_id = ?', [founderId]))
    .rows[0] as Record<string, unknown> | undefined;

  if (row === undefined) {
    await query(
      "INSERT INTO owner_visits (founder_id, looked_at, since) VALUES (?, datetime('now'), "
      + "datetime('now'))", [founderId]);
    return null;
  }

  const awayLongEnough = (await query(
    "SELECT datetime(?, ?) < datetime('now') AS yes",
    [String(row.looked_at), `+${String(A_SEPARATE_VISIT_MINUTES)} minutes`]))
    .rows[0] as Record<string, unknown>;

  if (Number(awayLongEnough.yes) === 1) {
    // A new visit: measure from when he was last here, and move the marker.
    await query(UPDATE_THE_MARKER, [founderId]);
    return String(row.looked_at);
  }
  // Still the same visit. The line holds still so a refresh does not erase what
  // he was reading.
  return String(row.since);
}

/**
 * WHAT HAPPENED WHILE HE WAS GONE.
 *
 * Four sources, each chosen because an owner would want to know: a search
 * started or stopped, an opportunity was taken forward or buried, a company
 * changed what it is for, and Foundry gained or lost a way of seeing. Anything
 * currently needing him is deliberately absent - that is the card above this
 * one, and saying it twice would make the screen longer to say less.
 */
export async function whatChangedSince(
  founderId: string, since: string | null, most = 4,
): Promise<{ changes: Change[]; more: number }> {
  if (since === null) return { changes: [], more: 0 };

  const changes: Change[] = [];

  const searches = (await query(
    `SELECT statement, opened_at, closed_at, closed_reason FROM venture_mandates
      WHERE founder_id = ? AND evidence_mode = 'real'
        AND (datetime(opened_at) > datetime(?) OR datetime(closed_at) > datetime(?))`,
    [founderId, since, since])).rows as unknown as Array<Record<string, unknown>>;
  for (const s of searches) {
    if (s.closed_at != null && String(s.closed_at) > since) {
      changes.push({ at: String(s.closed_at), said: 'I stopped looking for another way to '
        + `make money — ${String(s.closed_reason ?? 'you asked me to')}.` });
    } else {
      changes.push({ at: String(s.opened_at), said: 'I started looking for another way to '
        + 'make money.' });
    }
  }

  const decided = (await query(
    `SELECT headline, verdict, decided_at FROM venture_opportunities
      WHERE founder_id = ? AND evidence_mode = 'real' AND decided_at IS NOT NULL
        AND datetime(decided_at) > datetime(?)`,
    [founderId, since])).rows as unknown as Array<Record<string, unknown>>;
  for (const d of decided) {
    changes.push({ at: String(d.decided_at),
      said: String(d.verdict) === 'rejected'
        ? `I buried one: ${String(d.headline)}.`
        : `I took one forward: ${String(d.headline)}.` });
  }

  const postures = (await query(
    // A COMPANY FOUNDRY MADE UP CHANGING ITS POSTURE IS NOT NEWS ABOUT HIS
    // PORTFOLIO. The gate caught this: without the filter, a rehearsal company
    // deciding it was now something he harvests would appear here in exactly
    // the same words as one of his own.
    `SELECT p.name, c.to_posture, c.changed_at FROM posture_changes c
       JOIN products p ON p.id = c.product_id
      WHERE c.founder_id = ? AND datetime(c.changed_at) > datetime(?)
        AND ${realCompany('p')}`,
    [founderId, since])).rows as unknown as Array<Record<string, unknown>>;
  for (const p of postures) {
    changes.push({ at: String(p.changed_at),
      said: `${String(p.name)} is now something you ${String(p.to_posture)}.` });
  }

  // WHAT IT CAN AND CANNOT SEE IS HIS BUSINESS. A sense going dark is the
  // change most likely to make everything else quietly wrong, and it is exactly
  // the kind of thing that would otherwise only ever be visible in a log.
  const senses = (await query(
    `SELECT p.provider, m.to_maturity, m.changed_at
       FROM capability_maturity_changes m
       JOIN capability_providers p ON p.id = m.provider_id
      WHERE p.supplies_source_type IS NOT NULL AND m.evidence_mode = 'real'
        AND datetime(m.changed_at) > datetime(?)
        AND m.to_maturity IN ('available','degraded','unavailable','reality_proven')`,
    [since])).rows as unknown as Array<Record<string, unknown>>;
  for (const s of senses) {
    const gone = String(s.to_maturity) === 'degraded' || String(s.to_maturity) === 'unavailable';
    changes.push({ at: String(s.changed_at),
      said: gone ? `I have lost a way of looking — ${String(s.provider)} stopped answering.`
        : `I have a new way of looking — ${String(s.provider)}.` });
  }

  changes.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { changes: changes.slice(0, most), more: Math.max(0, changes.length - most) };
}
