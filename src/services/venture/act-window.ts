// =============================================================================
// FOUNDRY — How long a test runs, and how long the acts that carry it last.
//
// One pure reading (Roadmap 2027 R24), from the sealed rule's kind and the
// charter row, never from a caller. A Workshop test is read over thirty days;
// its acts last the window plus a margin, and a subscription's acts also keep
// the stop's lead, so the stop is made after the window closes and while the
// act still stands. Under a charter the window shrinks so no act outlives the
// term the owner signed, and a test that would be read for under fourteen days
// is not let in at all. A caller may shorten the acts, never lengthen them.
// =============================================================================

const DAY = 86_400_000;

/** The window a Workshop test is read over, when nothing shortens it. */
export const WORKSHOP_WINDOW_DAYS = 30;
/** Days an act lasts past the window, so a purchase on the last day is delivered. */
export const ACT_MARGIN_DAYS = 2;
/** The shortest window worth reading; under it a test is not let in. */
export const MIN_WINDOW_DAYS = 14;
/** A subscription is told to stop this many days before its acts lapse (R19). */
export const STOP_AHEAD_DAYS = 9;

export function windowAndValidity(input: {
  now: Date; recurring: boolean;
  /** The live charter's end, when a charter decides the acts; null when the owner does. */
  charterExpiresAt: string | null;
  /** A caller's own limit on the acts. It may only shorten them. */
  within?: Date;
}): { withinDays: number; actsExpireAt: Date } | { refused: string } {
  const lead = input.recurring ? STOP_AHEAD_DAYS : 0;
  let withinDays = WORKSHOP_WINDOW_DAYS;
  let end: number | null = null;
  if (input.charterExpiresAt) {
    end = new Date(input.charterExpiresAt.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(input.charterExpiresAt) ? '' : 'Z')).getTime();
    // Rounded: a charter signed a moment ago has thirty days left, not twenty-nine.
    // The acts are clamped to its end below, so rounding up never reaches past it.
    const daysLeft = Math.round((end - input.now.getTime()) / DAY);
    withinDays = Math.min(WORKSHOP_WINDOW_DAYS, daysLeft - ACT_MARGIN_DAYS - lead);
    if (withinDays < MIN_WINDOW_DAYS) {
      return { refused: `only ${String(Math.max(0, daysLeft))} days are left in the charter; a test needs at least ${String(MIN_WINDOW_DAYS)} to be read, so renew the charter or allow it yourself` };
    }
  }
  let acts = input.now.getTime() + (withinDays + ACT_MARGIN_DAYS + lead) * DAY;
  if (end !== null) acts = Math.min(acts, end);
  if (input.within) acts = Math.min(acts, input.within.getTime());
  return { withinDays, actsExpireAt: new Date(acts) };
}

/**
 * A PLACEMENT ACT THAT ENDS BEFORE ITS WINDOW CANNOT OPEN IT. A buyer on the
 * last day would pay into a window no act covers. Null when it covers.
 */
export function placementActCoversTheWindow(input: { now: Date; actExpiresAt: string; withinDays: number }): string | null {
  const ends = new Date(input.actExpiresAt.replace(' ', 'T') + (/[zZ]$/.test(input.actExpiresAt) ? '' : 'Z')).getTime();
  if (ends >= input.now.getTime() + input.withinDays * DAY) return null;
  return `the act that places it ends before the ${String(input.withinDays)}-day window it would open closes `
    + `(${new Date(ends).toISOString().slice(0, 10)}), so a buyer near the end would pay into a window nothing covers`;
}

/**
 * THE HOURS AN ACT IS PROPOSED FOR, never past what was sized. Rounded down:
 * rounding up put an act clamped to its charter's end a few seconds past it,
 * and the row guard (migration 382) refused it, so a charter launch failed
 * whenever the clock fell that way.
 */
export function actHoursUntil(actsExpireAt: Date, now: Date = new Date()): number {
  return Math.max(1, Math.floor((actsExpireAt.getTime() - now.getTime()) / 3_600_000));
}
