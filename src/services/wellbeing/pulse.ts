// =============================================================================
// FOUNDRY — Founder pulse (Ascent B5 / Human Law)
//
// The founder's state is telemetry. Computed entirely from data Foundry already
// has — no surveys, no new tracking:
//   • decision load: founder-resolved decisions last 7d vs their own trailing
//     4-week weekly average (a 2× week is a strain signal, whatever the number)
//   • late-night share: fraction of resolutions logged 23:00–05:00 IN THE
//     FOUNDER'S OWN STATED TIMEZONE, or null when they have not stated one
//   • rejection rate: high rejection weeks mean the agents are misaligned or
//     the founder is grinding against the system — either way, friction
// The pulse never diagnoses; it notices, kindly, with the numbers shown
// (Honesty Law). Consumers: the weekly pulse job (notifies only on 'overloaded')
// and, later, briefing pacing (defer non-critical alerts when strained).
// =============================================================================

import { query } from '../../db/client.js';

export type PulseSignal = 'steady' | 'strained' | 'overloaded';

export interface FounderPulse {
  signal: PulseSignal;
  decisions7d: number;
  weeklyAvgPrior4w: number;
  loadRatio: number | null;       // null when there's no prior baseline
  /** 0..1 of this week's resolutions at 23:00–05:00 in the founder's stated
   *  timezone. NULL when no timezone is stated, or when there were no
   *  decisions to place — see the note above `localHour`. */
  lateNightShare: number | null;
  rejectionRate7d: number;        // 0..1
  message: string;                // the kind, numbers-shown observation
}


/** The timezone the founder stated, or null. `founders.preferences` is a JSON
 *  blob and `timezone` is optional in `preferencesSchema`, so most rows have
 *  none — which is the whole point of returning null rather than guessing UTC. */
async function statedTimezone(productId: string): Promise<string | null> {
  try {
    const row = (await query(
      `SELECT f.preferences AS preferences FROM products p
         JOIN founders f ON f.id = p.owner_id
        WHERE p.id = ?`, [productId])).rows[0] as Record<string, unknown> | undefined;
    if (!row?.preferences) return null;
    const prefs = JSON.parse(String(row.preferences)) as { timezone?: unknown };
    const tz = typeof prefs.timezone === 'string' ? prefs.timezone.trim() : '';
    if (!tz) return null;
    // An unknown zone name would otherwise throw on every row below.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/**
 * The hour of `decided_at` on the founder's own clock, or null.
 *
 * TWO WRITERS, TWO FORMATS, ONE COLUMN. `decisions/queue.ts` writes
 * `new Date().toISOString()` — "2026-08-22T10:00:00.000Z" — and
 * `decisions/actions.ts` writes SQLite's `datetime('now')` — "2026-08-22
 * 10:00:00", UTC with nothing saying so. `Date.parse` reads the second as LOCAL
 * time, which on any server not set to UTC would shift the hour before the
 * timezone conversion even began. The space form is normalised explicitly.
 */
function localHour(decidedAt: string | null, timeZone: string): number | null {
  if (!decidedAt) return null;
  const iso = decidedAt.includes('T') ? decidedAt : `${decidedAt.replace(' ', 'T')}Z`;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(at);
    const parsed = Number(hour);
    return Number.isFinite(parsed) ? parsed % 24 : null;
  } catch {
    return null;
  }
}

export async function getFounderPulse(productId: string): Promise<FounderPulse> {
  const [thisWeek, prior4w, resolvedThisWeek, rejected, zone] = await Promise.all([
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-7 days')`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-35 days')
         AND decided_at <  datetime('now', '-7 days')`,
      [productId],
    ),
    query(
      `SELECT decided_at FROM decisions
       WHERE product_id = ? AND decided_by = 'founder'
         AND decided_at >= datetime('now', '-7 days')`,
      [productId],
    ),
    query(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE product_id = ? AND decided_by = 'founder' AND status = 'rejected'
         AND decided_at >= datetime('now', '-7 days')`,
      [productId],
    ),
    statedTimezone(productId),
  ]);

  const n = (r: typeof thisWeek): number => Number((r.rows[0] as Record<string, unknown>)?.n ?? 0);
  const decisions7d = n(thisWeek);
  const weeklyAvgPrior4w = n(prior4w) / 4;
  const loadRatio = weeklyAvgPrior4w > 0 ? decisions7d / weeklyAvgPrior4w : null;
  const rejectionRate7d = decisions7d > 0 ? n(rejected) / decisions7d : 0;

  // WHOSE ELEVEN O'CLOCK. This counted `strftime('%H', decided_at)` — the UTC
  // hour — and then told the founder the number was "between 11pm and 5am",
  // their clock. For a US-Pacific founder 4pm–10pm local IS 23:00–04:59 UTC, so
  // an ordinary working evening scored a late-night share of 1.0 and Foundry
  // said, in a message about their life, that all of their decisions were made
  // in the middle of the night.
  //
  // It was not cosmetic. The share feeds `strain`, two factors make
  // 'overloaded', and `ux/interruption.ts` drops every non-critical event two
  // rungs when the pulse is overloaded. Foundry quieted itself on a
  // mis-measured fact and then sent a note explaining why.
  //
  // Foundry does not know where a founder is unless they said. When they have
  // not, the share is NULL: it contributes no strain and the sentence is not
  // said. A statement about someone's nights is not a place to substitute.
  let lateNightShare: number | null = null;
  if (zone !== null && decisions7d > 0) {
    let late = 0;
    for (const row of resolvedThisWeek.rows as unknown as Array<{ decided_at: string | null }>) {
      const hour = localHour(row.decided_at, zone);
      if (hour !== null && (hour >= 23 || hour < 5)) late++;
    }
    lateNightShare = late / decisions7d;
  }

  // Strain scoring: each factor contributes independently; two factors = overloaded.
  let strain = 0;
  if (loadRatio != null && loadRatio >= 2) strain++;
  if (lateNightShare !== null && lateNightShare >= 0.4 && decisions7d >= 3) strain++;
  if (rejectionRate7d >= 0.5 && decisions7d >= 4) strain++;

  const signal: PulseSignal = strain >= 2 ? 'overloaded' : strain === 1 ? 'strained' : 'steady';

  const parts: string[] = [];
  if (loadRatio != null && loadRatio >= 2) {
    parts.push(`you resolved ${decisions7d} decisions this week — ${loadRatio.toFixed(1)}× your usual ${weeklyAvgPrior4w.toFixed(1)}/week`);
  }
  if (lateNightShare !== null && lateNightShare >= 0.4 && decisions7d >= 3) {
    parts.push(`${Math.round(lateNightShare * 100)}% of them were made between 11pm and 5am`);
  }
  if (rejectionRate7d >= 0.5 && decisions7d >= 4) {
    parts.push(`you rejected ${Math.round(rejectionRate7d * 100)}% of what was proposed — the agents may be misaligned with where your head is`);
  }
  const message = parts.length > 0
    ? `Noticing: ${parts.join('; ')}. Nothing here needs a decision tonight — the queue will keep.`
    : 'Decision pace looks steady this week.';

  return { signal, decisions7d, weeklyAvgPrior4w, loadRatio, lateNightShare, rejectionRate7d, message };
}
